import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { DocumentViewer } from '@/components/DocumentViewer';
import { Icon } from '@/components/Icon';
import { apiPost, requireInstallSecret } from '@/native-api';
import { friendlyError } from '@/messages';
import { type Profile } from '@/profile';
import { C } from '@/theme';

/**
 * Reading one stored document.
 *
 * A ROUTE rather than a modal, so it behaves like every other screen: the iOS edge
 * swipe goes back, the Android back button goes back, and the slide matches the
 * rest of the app. A modal sits outside the navigation stack, so neither gesture
 * applied to it.
 *
 * It takes the document's TYPE and looks the file up here, rather than being handed
 * the signed URL. Navigation parameters are kept in router state and show up in
 * logs and deep links, and these are passports -- the type is a harmless label
 * where the URL is not.
 */
export default function DocumentScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const secret = await requireInstallSecret();
      setProfile(await apiPost<Profile>('/api/mobile/profile', { install_secret: secret }));
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);

  // Load-on-mount, the same shape documents.tsx uses.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const doc = profile?.documents.find((d) => d.doc_type === type) ?? null;
  const back = () => router.back();

  if (error || (profile && !doc?.current_url)) {
    return (
      <View style={styles.page}>
        <View style={styles.message}>
          <Icon name="alert" size={28} color={C.danger} strokeWidth={2.2} />
          <Text style={styles.messageText}>
            {error ?? 'That document is no longer available.'}
          </Text>
          <Text style={styles.back} onPress={back} accessibilityRole="button">Go back</Text>
        </View>
      </View>
    );
  }

  if (!doc?.current_url) {
    return (
      <View style={[styles.page, styles.centred]}>
        <ActivityIndicator size="large" color={C.brand} />
      </View>
    );
  }

  return (
    <DocumentViewer
      url={doc.current_url}
      mimeType={doc.current_mime}
      title={doc.label}
      onClose={back}
    />
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.canvas },
  centred: { alignItems: 'center', justifyContent: 'center' },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  messageText: { color: C.muted, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  back: { color: C.brand, fontSize: 15, fontWeight: '700', paddingVertical: 10, paddingHorizontal: 16 },
});
