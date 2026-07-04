import { useEffect, useMemo, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  View
} from 'react-native';

WebBrowser.maybeCompleteAuthSession();

// ─── Config ────────────────────────────────────────────────────────
const TOKEN_STORAGE_KEY = 'installation_app_okta_tokens';
const DEVICE_API_URL = process.env.EXPO_PUBLIC_DEVICE_API_URL;
const JOBS_API_URL   = process.env.EXPO_PUBLIC_JOBS_API_URL;

const oktaConfig = {
  issuer:         process.env.EXPO_PUBLIC_OKTA_ISSUER,
  clientId:       process.env.EXPO_PUBLIC_OKTA_CLIENT_ID,
  scopes:         (process.env.EXPO_PUBLIC_OKTA_SCOPES || 'openid profile email groups').split(' ').filter(Boolean),
  redirectScheme: process.env.EXPO_PUBLIC_OKTA_REDIRECT_SCHEME || 'com.installationapp'
};

// ─── Mock data (fallback when API URL is not set) ───────────────────
const MOCK_DEVICES = [
  { id: 1, deviceName: 'PUI Device',          serialNumber: 'SN-1001', status: 'Pending'   },
  { id: 2, deviceName: 'GPS Tracker',          serialNumber: 'SN-1002', status: 'Installed' },
  { id: 3, deviceName: 'Temperature Sensor',   serialNumber: 'SN-1003', status: 'Failed'    },
  { id: 4, deviceName: 'Pressure Monitor',     serialNumber: 'SN-1004', status: 'Installed' },
  { id: 5, deviceName: 'Flow Meter',           serialNumber: 'SN-1005', status: 'Pending'   }
];

const MOCK_JOBS = [
  { id: 1, title: 'Install GPS Tracker',       status: 'In Progress', location: 'Site A' },
  { id: 2, title: 'Setup PUI Device',          status: 'Pending',     location: 'Site B' },
  { id: 3, title: 'Configure Flow Meter',      status: 'Completed',   location: 'Site C' },
  { id: 4, title: 'Replace Pressure Monitor',  status: 'Pending',     location: 'Site A' },
  { id: 5, title: 'Fix Temperature Sensor',    status: 'Failed',      location: 'Site D' },
  { id: 6, title: 'Calibrate Temp Sensor',     status: 'Completed',   location: 'Site B' },
  { id: 7, title: 'Install New Flow Meter',    status: 'In Progress', location: 'Site C' }
];

// ─── Status colour maps ─────────────────────────────────────────────
const DEVICE_COLORS = {
  Pending:   { bg: '#FFEDD5', text: '#C2410C', dot: '#F97316' },
  Installed: { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' },
  Failed:    { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444' }
};

const JOB_COLORS = {
  'Pending':     { bg: '#FEF9C3', text: '#854D0E', dot: '#EAB308' },
  'In Progress': { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' },
  'Completed':   { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' },
  'Failed':      { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444' }
};

// ─── Layout constant ────────────────────────────────────────────────
const BRAND_HEIGHT = Dimensions.get('window').height * 0.38;

// ─── Helpers ────────────────────────────────────────────────────────
function isOktaConfigured() {
  return Boolean(oktaConfig.issuer && oktaConfig.clientId);
}

function createOktaDiscovery(issuer) {
  if (!issuer) return null;
  const base = issuer.replace(/\/$/, '');
  // Okta exposes two kinds of authorization server, and their endpoints
  // live in different places:
  //   • Org server    → issuer is the bare domain (https://x.okta.com);
  //                      endpoints are under /oauth2/v1/*
  //   • Custom server → issuer ends in /oauth2/<id> (e.g. /oauth2/default);
  //                      endpoints are under <issuer>/v1/*
  // Normalise to the right root so either issuer style works.
  const root = /\/oauth2(\/|$)/.test(base) ? base : `${base}/oauth2`;
  return {
    authorizationEndpoint: `${root}/v1/authorize`,
    tokenEndpoint:         `${root}/v1/token`,
    revocationEndpoint:    `${root}/v1/revoke`,
    userInfoEndpoint:      `${root}/v1/userinfo`
  };
}

async function apiFetch(url, accessToken, fallback) {
  if (!url) return fallback;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

function countByStatus(items) {
  return items.reduce((acc, item) => {
    const s = item.status || 'Unknown';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
}

// ─── Shared components ──────────────────────────────────────────────
function StatusBadge({ status, colorMap }) {
  const c = colorMap[status] || { bg: '#F1F5F9', text: '#475569' };
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.text }]}>{status}</Text>
    </View>
  );
}

// ─── Summary card (used on Dashboard) ──────────────────────────────
function SummaryCard({ title, iconEmoji, iconBubbleStyle, total, statusCounts, colorMap, isLoading, onViewAll }) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.cardIconRow}>
        <View style={[styles.cardIconBubble, iconBubbleStyle]}>
          <Text style={styles.cardIconText}>{iconEmoji}</Text>
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#2563EB" style={{ marginVertical: 18 }} />
      ) : (
        <>
          <Text style={styles.cardTotal}>{total}</Text>
          <View style={styles.cardDivider} />
          {Object.entries(statusCounts).map(([status, count]) => {
            const c = colorMap[status] || { dot: '#94A3B8' };
            return (
              <View key={status} style={styles.cardStatusRow}>
                <View style={styles.cardStatusLeft}>
                  <View style={[styles.cardStatusDot, { backgroundColor: c.dot }]} />
                  <Text style={styles.cardStatusLabel}>{status}</Text>
                </View>
                <Text style={styles.cardStatusCount}>{count}</Text>
              </View>
            );
          })}
          <Pressable onPress={onViewAll} style={styles.cardViewAll}>
            <Text style={styles.cardViewAllText}>View All →</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

// ─── LOGIN SCREEN ───────────────────────────────────────────────────
function LoginScreen({ errorMessage, isLoading, onSignIn, request }) {
  const configReady = isOktaConfigured();

  return (
    <View style={styles.loginRoot}>
      <StatusBar barStyle="light-content" backgroundColor="#1E3A8A" />
      <SafeAreaView style={styles.loginSafeArea}>
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.loginScroll}
        >
          {/* Navy brand block */}
          <View style={styles.loginBrand}>
            <View style={styles.loginLogoCircle}>
              <Text style={styles.loginLogoText}>SI</Text>
            </View>
            <Text style={styles.loginAppName}>Sunbelt Installer</Text>
            <Text style={styles.loginTagline}>Field Device Management Platform</Text>
          </View>

          {/* White form card */}
          <View style={styles.loginCard}>
            <Text style={styles.loginWelcome}>Welcome Back</Text>
            <Text style={styles.loginHint}>
              Sign in with your Okta account to continue
            </Text>

            <Pressable
              disabled={!configReady || !request || isLoading}
              onPress={onSignIn}
              style={({ pressed }) => [
                styles.signInButton,
                (!configReady || !request || isLoading) && styles.signInButtonDisabled,
                pressed && styles.signInButtonPressed
              ]}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.signInButtonText}>Sign In with Okta</Text>
              )}
            </Pressable>

            {!configReady && (
              <Text style={styles.loginMessage}>
                Configure Okta environment variables to enable sign in.
              </Text>
            )}
            {errorMessage ? (
              <Text style={styles.errorText}>{errorMessage}</Text>
            ) : null}

            <Text style={styles.loginFooterText}>🔒  Secured by Okta SSO</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── DASHBOARD SCREEN ───────────────────────────────────────────────
function DashboardScreen({ accessToken, onSignOut, userInfo, onViewDevices }) {
  const [devices, setDevices] = useState([]);
  const [jobs, setJobs]       = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [d, j] = await Promise.all([
          apiFetch(DEVICE_API_URL, accessToken, MOCK_DEVICES),
          apiFetch(JOBS_API_URL,   accessToken, MOCK_JOBS)
        ]);
        if (!cancelled) { setDevices(d); setJobs(j); }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load data.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [accessToken]);

  const deviceCounts = countByStatus(devices);
  const jobCounts    = countByStatus(jobs);

  const firstName =
    userInfo?.given_name ||
    userInfo?.name?.split(' ')[0] ||
    userInfo?.email?.split('@')[0] ||
    'Technician';

  const activeJobs    = jobs.filter(j => j.status === 'In Progress').length;
  const installed     = devices.filter(d => d.status === 'Installed').length;
  const failures      = jobs.filter(j => j.status === 'Failed').length +
                        devices.filter(d => d.status === 'Failed').length;
  const completed     = jobs.filter(j => j.status === 'Completed').length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.dashContainer}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.dashScroll}
      >
        {/* Header */}
        <View style={styles.dashHeader}>
          <View>
            <Text style={styles.dashGreeting}>Hello, {firstName} 👋</Text>
            <Text style={styles.dashRole}>Installation Technician</Text>
          </View>
          <Pressable onPress={onSignOut} style={styles.signOutButton}>
            <Text style={styles.signOutButtonText}>Sign Out</Text>
          </Pressable>
        </View>

        {/* System status banner */}
        <View style={styles.statusBanner}>
          <View style={styles.statusDot} />
          <Text style={styles.statusBannerText}>System Online — Data refreshed just now</Text>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Section label */}
        <Text style={styles.sectionLabel}>Overview</Text>

        {/* Summary cards */}
        <View style={styles.cardsRow}>
          <SummaryCard
            title="Jobs"
            iconEmoji="🔧"
            iconBubbleStyle={styles.cardIconBubbleJobs}
            total={isLoading ? '—' : jobs.length}
            statusCounts={jobCounts}
            colorMap={JOB_COLORS}
            isLoading={isLoading}
            onViewAll={() => {}}
          />
          <SummaryCard
            title="Devices"
            iconEmoji="📡"
            iconBubbleStyle={styles.cardIconBubbleDevices}
            total={isLoading ? '—' : devices.length}
            statusCounts={deviceCounts}
            colorMap={DEVICE_COLORS}
            isLoading={isLoading}
            onViewAll={onViewDevices}
          />
        </View>

        {/* Quick stats 2×2 grid */}
        {!isLoading && (
          <>
            <Text style={styles.sectionLabel}>Quick Stats</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statTile}>
                <Text style={styles.statTileLabel}>Active Jobs</Text>
                <Text style={[styles.statTileValue, { color: '#2563EB' }]}>{activeJobs}</Text>
                <Text style={styles.statTileSubLabel}>In progress</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statTileLabel}>Installed</Text>
                <Text style={[styles.statTileValue, { color: '#16A34A' }]}>{installed}</Text>
                <Text style={styles.statTileSubLabel}>Devices online</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statTileLabel}>Failures</Text>
                <Text style={[styles.statTileValue, { color: '#DC2626' }]}>{failures}</Text>
                <Text style={styles.statTileSubLabel}>Needs attention</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statTileLabel}>Completed</Text>
                <Text style={[styles.statTileValue, { color: '#0F172A' }]}>{completed}</Text>
                <Text style={styles.statTileSubLabel}>Jobs done</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── DEVICES SCREEN ─────────────────────────────────────────────────
function TableHeader() {
  return (
    <View style={[styles.tableRow, styles.tableHeaderRow]}>
      <Text style={[styles.tableHeaderCell, styles.colIndex]}>#</Text>
      <Text style={[styles.tableHeaderCell, styles.colName]}>Device Name</Text>
      <Text style={[styles.tableHeaderCell, styles.colSerial]}>Serial No.</Text>
      <Text style={[styles.tableHeaderCell, styles.colStatus]}>Status</Text>
    </View>
  );
}

function TableRow({ item, index }) {
  return (
    <View style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}>
      <Text style={[styles.tableCell, styles.colIndex]}>{index + 1}</Text>
      <Text style={[styles.tableCell, styles.colName]} numberOfLines={2}>{item.deviceName}</Text>
      <Text style={[styles.tableCell, styles.colSerial]}>{item.serialNumber}</Text>
      <View style={[styles.colStatus, styles.tableCellStatus]}>
        <StatusBadge status={item.status} colorMap={DEVICE_COLORS} />
      </View>
    </View>
  );
}

function DevicesScreen({ accessToken, onBack }) {
  const [devices, setDevices]     = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiFetch(DEVICE_API_URL, accessToken, MOCK_DEVICES);
        if (!cancelled) setDevices(data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load devices.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [accessToken]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        {/* Header with back button */}
        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </Pressable>
          <View>
            <Text style={styles.title}>Devices</Text>
            <Text style={styles.subtitle}>Installation List</Text>
          </View>
          <View style={{ width: 70 }} />
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total Devices</Text>
          <Text style={styles.summaryCount}>{isLoading ? '—' : devices.length}</Text>
        </View>

        {isLoading ? (
          <View style={styles.centeredState}>
            <ActivityIndicator color="#2563EB" size="large" />
            <Text style={styles.stateText}>Loading devices…</Text>
          </View>
        ) : error ? (
          <View style={styles.centeredState}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <View style={styles.tableWrapper}>
            <FlatList
              data={devices}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item, index }) => <TableRow item={item} index={index} />}
              ListHeaderComponent={<TableHeader />}
              stickyHeaderIndices={[0]}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.tableContent}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── ROOT APP ───────────────────────────────────────────────────────
export default function App() {
  const [tokens, setTokens]           = useState(null);
  const [userInfo, setUserInfo]       = useState(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentScreen, setCurrentScreen] = useState('dashboard');

  const redirectUri = useMemo(
    () => AuthSession.makeRedirectUri({ native: `${oktaConfig.redirectScheme}://redirect` }),
    []
  );

  const discovery = useMemo(() => createOktaDiscovery(oktaConfig.issuer), []);

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId:     oktaConfig.clientId || '',
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes:       oktaConfig.scopes,
      usePKCE:      true
    },
    discovery
  );

  // Restore session on mount
  useEffect(() => {
    async function restoreSession() {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setTokens(parsed);
          await loadUserInfo(parsed);
        }
      } catch {
        await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
      } finally {
        setIsRestoring(false);
      }
    }
    restoreSession();
  }, []);

  // Handle Okta auth response
  useEffect(() => {
    async function handleAuthResponse() {
      if (!response || !discovery) return;

      if (response.type === 'success') {
        setIsSigningIn(true);
        setErrorMessage('');
        try {
          const tokenResponse = await AuthSession.exchangeCodeAsync(
            {
              clientId:   oktaConfig.clientId,
              code:       response.params.code,
              redirectUri,
              extraParams: { code_verifier: request.codeVerifier }
            },
            discovery
          );

          const nextTokens = {
            accessToken:  tokenResponse.accessToken,
            idToken:      tokenResponse.idToken,
            refreshToken: tokenResponse.refreshToken,
            issuedAt:     tokenResponse.issuedAt,
            expiresIn:    tokenResponse.expiresIn,
            tokenType:    tokenResponse.tokenType
          };

          await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, JSON.stringify(nextTokens));
          setTokens(nextTokens);
          await loadUserInfo(nextTokens);
        } catch (error) {
          setErrorMessage(error.message || 'Unable to complete Okta sign in.');
        } finally {
          setIsSigningIn(false);
        }
      }

      if (response.type === 'error') {
        const code = response.error?.code;
        if (code === 'access_denied') {
          setErrorMessage('Access denied. Contact your administrator to get assigned to this app.');
        } else {
          setErrorMessage(response.error?.message || 'Okta sign in failed.');
        }
      }
    }
    handleAuthResponse();
  }, [response, discovery, redirectUri, request]);

  async function loadUserInfo(nextTokens) {
    if (!discovery?.userInfoEndpoint || !nextTokens?.accessToken) return;
    const res = await fetch(discovery.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${nextTokens.accessToken}` }
    });
    if (res.ok) setUserInfo(await res.json());
  }

  async function handleSignIn() {
    if (!isOktaConfigured()) {
      setErrorMessage('Missing Okta issuer or client ID.');
      return;
    }
    setErrorMessage('');
    await promptAsync();
  }

  async function handleSignOut() {
    await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
    setTokens(null);
    setUserInfo(null);
    setCurrentScreen('dashboard');
  }

  // Loading splash
  if (isRestoring) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#1E3A8A" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // Not authenticated → Login
  if (!tokens) {
    return (
      <LoginScreen
        errorMessage={errorMessage}
        isLoading={isSigningIn}
        onSignIn={handleSignIn}
        request={request}
      />
    );
  }

  // Devices detail screen
  if (currentScreen === 'devices') {
    return (
      <DevicesScreen
        accessToken={tokens.accessToken}
        onBack={() => setCurrentScreen('dashboard')}
      />
    );
  }

  // Default: Dashboard
  return (
    <DashboardScreen
      accessToken={tokens.accessToken}
      onSignOut={handleSignOut}
      userInfo={userInfo}
      onViewDevices={() => setCurrentScreen('devices')}
    />
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({

  // ── Shared ──────────────────────────────────────────────
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  loadingContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center'
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 14,
    textAlign: 'center'
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase'
  },

  // ── Login ────────────────────────────────────────────────
  loginRoot: {
    flex: 1,
    backgroundColor: '#1E3A8A'
  },
  loginSafeArea: {
    flex: 1,
    backgroundColor: 'transparent'
  },
  loginScroll: {
    flexGrow: 1
  },
  loginBrand: {
    height: BRAND_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10
  },
  loginLogoCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8
  },
  loginLogoText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 2
  },
  loginAppName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center'
  },
  loginTagline: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center'
  },
  loginCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 40,
    marginTop: -24
  },
  loginWelcome: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '900',
    marginBottom: 8
  },
  loginHint: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 21,
    marginBottom: 32
  },
  signInButton: {
    alignItems: 'center',
    backgroundColor: '#1E3A8A',
    borderRadius: 14,
    height: 56,
    justifyContent: 'center',
    width: '100%'
  },
  signInButtonDisabled: {
    backgroundColor: '#94A3B8'
  },
  signInButtonPressed: {
    opacity: 0.88
  },
  signInButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3
  },
  loginMessage: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 16,
    textAlign: 'center'
  },
  loginFooterText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 32
  },

  // ── Dashboard ────────────────────────────────────────────
  dashContainer: {
    flex: 1
  },
  dashScroll: {
    paddingBottom: 36
  },
  dashHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16
  },
  dashGreeting: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900'
  },
  dashRole: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3
  },
  signOutButton: {
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  signOutButtonText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800'
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 22,
    backgroundColor: '#DCFCE7',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 8
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16A34A'
  },
  statusBannerText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '700'
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    alignItems: 'center'
  },
  sectionLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
    marginHorizontal: 20
  },
  cardsRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    gap: 12,
    marginBottom: 28
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2
  },
  cardIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8
  },
  cardIconBubble: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cardIconBubbleJobs: {
    backgroundColor: '#EFF6FF'
  },
  cardIconBubbleDevices: {
    backgroundColor: '#F0FDF4'
  },
  cardIconText: {
    fontSize: 15
  },
  cardTitle: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  cardTotal: {
    color: '#0F172A',
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 38,
    marginBottom: 12
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginBottom: 10
  },
  cardStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6
  },
  cardStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  cardStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  cardStatusLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600'
  },
  cardStatusCount: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800'
  },
  cardViewAll: {
    marginTop: 14,
    alignSelf: 'flex-end'
  },
  cardViewAllText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700'
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 20,
    gap: 12,
    marginBottom: 8
  },
  statTile: {
    width: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1
  },
  statTileLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8
  },
  statTileValue: {
    fontSize: 28,
    fontWeight: '900'
  },
  statTileSubLabel: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4
  },

  // ── Devices screen ───────────────────────────────────────
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16
  },
  title: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center'
  },
  subtitle: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2
  },
  backButton: {
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  backButtonText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800'
  },
  summaryRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  summaryLabel: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  summaryCount: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800'
  },
  centeredState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    gap: 12
  },
  stateText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600'
  },

  // ── Table ────────────────────────────────────────────────
  tableWrapper: {
    borderColor: '#E2E8F0',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden'
  },
  tableContent: {
    flexGrow: 1
  },
  tableHeaderRow: {
    backgroundColor: '#1D4ED8',
    flexDirection: 'row'
  },
  tableRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#E2E8F0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 52
  },
  tableRowAlt: {
    backgroundColor: '#F8FAFC'
  },
  tableHeaderCell: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 13,
    textTransform: 'uppercase'
  },
  tableCell: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  tableCellStatus: {
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  colIndex: {
    width: 36,
    textAlign: 'center'
  },
  colName: {
    flex: 1
  },
  colSerial: {
    width: 110
  },
  colStatus: {
    width: 108
  }
});
