import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { io } from 'socket.io-client';

const API_URL = 'https://unconsummated-della-ectromelic.ngrok-free.dev';

function getLeadId(lead, index) {
  return String(lead.leadgen_id || lead.id || `lead-${index}`);
}

function getLeadFields(lead) {
  return lead?.fields && typeof lead.fields === 'object'
    ? lead.fields
    : lead || {};
}

function getFieldValue(fields, ...names) {
  for (const name of names) {
    const value = fields[name];
    if (Array.isArray(value) && value.length > 0) {
      return value[0];
    }
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

function formatReceivedTime(lead) {
  const value = lead.received_at || lead.receivedAt || lead.created_time;
  if (!value) {
    return 'Time unavailable';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Time unavailable';
  }

  return `Received ${date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function LeadCard({ lead }) {
  const fields = getLeadFields(lead);
  const [highlight] = useState(
    () => new Animated.Value(lead.__highlight ? 0 : 1),
  );
  const name =
    getFieldValue(fields, 'full_name', 'name') ||
    [getFieldValue(fields, 'first_name'), getFieldValue(fields, 'last_name')]
      .filter(Boolean)
      .join(' ') ||
    'New lead';
  const email = getFieldValue(fields, 'email');
  const phone = getFieldValue(fields, 'phone', 'phone_number');

  useEffect(() => {
    if (lead.__highlight) {
      Animated.timing(highlight, {
        toValue: 1,
        duration: 1400,
        useNativeDriver: false,
      }).start();
    }
  }, [highlight, lead.__highlight]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: highlight.interpolate({
            inputRange: [0, 1],
            outputRange: ['#dcf7e7', '#ffffff'],
          }),
        },
      ]}
    >
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.detail}>{email || 'No email provided'}</Text>
      <Text style={styles.detail}>{phone || 'No phone provided'}</Text>
      <Text style={styles.receivedTime}>{formatReceivedTime(lead)}</Text>
    </Animated.View>
  );
}

export default function App() {
  const [leads, setLeads] = useState([]);
  const [isOnline, setIsOnline] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const socket = io(API_URL, { transports: ['websocket'] });
    let hasConnected = false;
    let activeFetchController;

    function loadLeads() {
      activeFetchController?.abort();
      const fetchController = new AbortController();
      activeFetchController = fetchController;

      fetch(`${API_URL}/leads`, {
        headers: { 'ngrok-skip-browser-warning': '1' },
        signal: fetchController.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to load leads: HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((data) => {
          if (!Array.isArray(data)) {
            throw new Error('The leads endpoint did not return an array');
          }
          setLeads((currentLeads) => {
            const highlightedById = new Map(
              currentLeads
                .filter((lead) => lead.__highlight)
                .map((lead, index) => [getLeadId(lead, index), lead]),
            );
            const fetchedIds = new Set(
              data.map((lead, index) => getLeadId(lead, index)),
            );
            const refreshedLeads = data.map(
              (lead, index) => highlightedById.get(getLeadId(lead, index)) || lead,
            );
            const arrivalsMissingFromResponse = currentLeads.filter(
              (lead, index) =>
                lead.__highlight && !fetchedIds.has(getLeadId(lead, index)),
            );

            return [...arrivalsMissingFromResponse, ...refreshedLeads];
          });
        })
        .catch((error) => {
          if (error.name !== 'AbortError') {
            console.error('Unable to fetch leads', error);
          }
        })
        .finally(() => {
          if (activeFetchController === fetchController) {
            activeFetchController = null;
            setIsLoading(false);
          }
        });
    }

    socket.on('connect', () => {
      setIsOnline(true);
      if (hasConnected) {
        loadLeads();
      }
      hasConnected = true;
    });
    socket.on('disconnect', () => setIsOnline(false));
    socket.on('connect_error', () => setIsOnline(false));
    socket.on('new_lead', (lead) => {
      const receivedLead = {
        ...lead,
        received_at: lead.received_at || new Date().toISOString(),
        __highlight: true,
      };
      const leadId = getLeadId(receivedLead);
      setLeads((currentLeads) => [
        receivedLead,
        ...currentLeads.filter(
          (currentLead, index) => getLeadId(currentLead, index) !== leadId,
        ),
      ]);
    });

    loadLeads();

    return () => {
      activeFetchController?.abort();
      socket.disconnect();
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Leads</Text>
          <Text style={styles.subtitle}>Meta Lead Ads</Text>
        </View>
        <View style={styles.status}>
          <View
            style={[
              styles.statusDot,
              isOnline ? styles.onlineDot : styles.offlineDot,
            ]}
          />
          <Text
            style={[
              styles.statusText,
              isOnline ? styles.onlineText : styles.offlineText,
            ]}
          >
            {isOnline ? 'live' : 'offline'}
          </Text>
        </View>
      </View>

      <FlatList
        contentContainerStyle={styles.list}
        data={leads}
        keyExtractor={getLeadId}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {isLoading ? (
              <ActivityIndicator color="#16834a" />
            ) : (
              <Text style={styles.emptyText}>Waiting for leads...</Text>
            )}
          </View>
        }
        renderItem={({ item }) => <LeadCard lead={item} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f7f5',
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomColor: '#e5ebe7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  title: {
    color: '#17231c',
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: '#718078',
    fontSize: 14,
    marginTop: 3,
  },
  status: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  statusDot: {
    borderRadius: 5,
    height: 9,
    width: 9,
  },
  onlineDot: {
    backgroundColor: '#20a45b',
  },
  offlineDot: {
    backgroundColor: '#d34c4c',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  onlineText: {
    color: '#16834a',
  },
  offlineText: {
    color: '#c33f3f',
  },
  list: {
    flexGrow: 1,
    padding: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#e5ebe7',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
  },
  name: {
    color: '#17231c',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
  },
  detail: {
    color: '#65736b',
    fontSize: 14,
    lineHeight: 21,
  },
  receivedTime: {
    color: '#87938c',
    fontSize: 12,
    marginTop: 10,
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: '#718078',
    fontSize: 15,
  },
});
