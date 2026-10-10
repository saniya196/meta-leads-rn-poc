import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { io } from 'socket.io-client';

const API_URL = 'https://unconsummated-della-ectromelic.ngrok-free.dev';

function getLeadFields(lead) {
  return lead?.fields && typeof lead.fields === 'object' ? lead.fields : lead || {};
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

function LeadCard({ lead }) {
  const fields = getLeadFields(lead);
  const name =
    getFieldValue(fields, 'full_name', 'name') ||
    [getFieldValue(fields, 'first_name'), getFieldValue(fields, 'last_name')]
      .filter(Boolean)
      .join(' ') ||
    'New lead';
  const email = getFieldValue(fields, 'email');
  const phone = getFieldValue(fields, 'phone', 'phone_number');

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.detail}>{email || 'No email provided'}</Text>
      <Text style={styles.detail}>{phone || 'No phone provided'}</Text>
    </View>
  );
}

export default function App() {
  const [leads, setLeads] = useState([]);
  const [isOnline, setIsOnline] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const socket = io(API_URL, { transports: ['websocket'] });

    socket.on('connect', () => setIsOnline(true));
    socket.on('disconnect', () => setIsOnline(false));
    socket.on('connect_error', () => setIsOnline(false));
    socket.on('new_lead', (lead) => {
      setLeads((currentLeads) => [lead, ...currentLeads]);
    });

    fetch(`${API_URL}/leads`, {
      headers: { 'ngrok-skip-browser-warning': '1' },
      signal: controller.signal,
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
        setLeads(data);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('Unable to fetch leads', error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
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
        keyExtractor={(lead, index) =>
          String(lead.leadgen_id || lead.id || `lead-${index}`)
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {isLoading ? (
              <ActivityIndicator color="#16834a" />
            ) : (
              <Text style={styles.emptyText}>No leads yet</Text>
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
