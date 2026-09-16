import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  type AlertButton,
  FlatList,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchHutGallery } from '../../src/api/hutPhotos';
import { COLORS, GRADIENT, RADIUS } from '../../src/constants/theme';
import { bundledHutById } from '../../src/data/hutBundle';
import { getUserPhotos, useHutUserDataStore } from '../../src/store/hutUserDataStore';
import { useTripStore } from '../../src/store/tripStore';
import type { Hut } from '../../src/types/hut';
import { parseFacilities } from '../../src/utils/facilities';
import type { HutImage } from '../../src/utils/hutImage';
import { hutTypeLabel } from '../../src/utils/hutMeta';
import { deletePhotoFile, savePhoto } from '../../src/utils/photoStorage';

export default function HutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  // Resolve the hut straight from the offline bundle (any region, no fetch) or,
  // as a fallback, the current route's own full hut objects — so a hut reached
  // from a saved route in a region you haven't selected still opens.
  const routeHuts = useTripStore((s) => s.huts);
  const hut = useMemo(
    () => bundledHutById(id) ?? routeHuts.find((h) => h.id === id),
    [id, routeHuts],
  );

  const inRoute = routeHuts.some((h) => h.id === id);
  const toggle = useTripStore((s) => s.toggle);

  const userData = useHutUserDataStore((s) => s.data[id]);
  const addPhoto = useHutUserDataStore((s) => s.addPhoto);
  const removePhoto = useHutUserDataStore((s) => s.removePhoto);
  const clearPhotos = useHutUserDataStore((s) => s.clearPhotos);
  const setNotes = useHutUserDataStore((s) => s.setNotes);
  const userPhotos = getUserPhotos(userData);

  const [imageFailed, setImageFailed] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  useEffect(() => setNotesDraft(userData?.notes ?? ''), [userData?.notes, id]);

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Web photos of the hut (OSM + Wikidata + Wikipedia + Commons category).
  const { data: webPhotos, isFetching: webFetching } = useQuery({
    queryKey: ['hut-gallery', id],
    queryFn: ({ signal }) => fetchHutGallery(hut as Hut, signal),
    enabled: !!hut,
    staleTime: 1000 * 60 * 60,
  });

  // Full ordered gallery: the user's photos first, then the web photos.
  const photos: HutImage[] = useMemo(
    () => [
      ...userPhotos.map((url) => ({ url, credit: 'Your photo' })),
      ...(webPhotos ?? []),
    ],
    [userPhotos, webPhotos],
  );
  const cover = photos[0] ?? null;
  const coverLoading = webFetching && photos.length === 0;

  const pickPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        `Please allow ${fromCamera ? 'camera' : 'photo library'} access to add a hut photo.`,
      );
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    const uri = result.assets?.[0]?.uri;
    if (!result.canceled && uri) {
      let stored = uri;
      try {
        stored = await savePhoto(id, uri);
      } catch {
        stored = uri;
      }
      addPhoto(id, stored);
      setImageFailed(false);
    }
  };

  const removeAllUserPhotos = () => {
    userPhotos.forEach((u) => deletePhotoFile(u).catch(() => {}));
    clearPhotos(id);
    setGalleryOpen(false);
  };

  const removeUserPhotoAt = (uri: string) => {
    deletePhotoFile(uri).catch(() => {});
    removePhoto(id, uri);
    setGalleryIndex((i) => Math.max(0, i - 1));
    if (photos.length <= 1) setGalleryOpen(false);
  };

  const onPhotoPress = () => {
    const buttons: AlertButton[] = [
      { text: 'Take photo', onPress: () => pickPhoto(true) },
      { text: 'Choose from library', onPress: () => pickPhoto(false) },
    ];
    if (userPhotos.length > 0) {
      buttons.push({
        text: `Remove my photos (${userPhotos.length})`,
        style: 'destructive',
        onPress: removeAllUserPhotos,
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Hut photos', 'Add your own photos of this hut.', buttons);
  };

  const openGallery = () => {
    if (photos.length > 0) {
      setGalleryIndex(0);
      setGalleryOpen(true);
    }
  };

  if (!hut) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missingTitle}>Hut not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const showCover = cover != null && !imageFailed;
  const kind = hutTypeLabel(hut.type);
  const facilities = parseFacilities(hut.tags);
  const operator = hut.tags.operator || hut.tags.owner;
  const phone = hut.tags.phone || hut.tags['contact:phone'];
  const email = hut.tags.email || hut.tags['contact:email'];

  return (
    <>
      <Stack.Screen options={{ title: hut.name }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <TouchableOpacity
            activeOpacity={0.9}
            disabled={!showCover}
            onPress={openGallery}
          >
            {showCover ? (
              <Image
                source={{ uri: cover!.url }}
                style={styles.photo}
                resizeMode="cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <View style={[styles.photo, styles.placeholder]}>
                {coverLoading ? (
                  <ActivityIndicator color="#9a9a9a" />
                ) : (
                  <>
                    <Ionicons name="image-outline" size={44} color="#b8b8b8" />
                    <Text style={styles.placeholderText}>No photo available</Text>
                  </>
                )}
              </View>
            )}
          </TouchableOpacity>

          {showCover && (
            <Text style={styles.credit} pointerEvents="none">
              {cover!.credit}
            </Text>
          )}

          {photos.length > 1 && (
            <View style={styles.countBadge} pointerEvents="none">
              <Ionicons name="images" size={13} color="white" />
              <Text style={styles.countText}>{photos.length}</Text>
            </View>
          )}

          <TouchableOpacity style={styles.cameraBtn} onPress={onPhotoPress}>
            <Ionicons name="camera" size={16} color="white" />
            <Text style={styles.cameraBtnText}>Add photo</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.name}>{hut.name}</Text>
          <Text style={styles.meta}>
            {kind}
            {hut.elevation != null ? ` · ${Math.round(hut.elevation)} m` : ''}
            {operator ? ` · ${operator}` : ''}
          </Text>

          <TouchableOpacity activeOpacity={0.85} onPress={() => toggle(hut)}>
            <LinearGradient
              colors={inRoute ? ['#c26a28', '#e0913f'] : GRADIENT.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.action}
            >
              <Ionicons
                name={inRoute ? 'checkmark-circle' : 'add-circle-outline'}
                size={20}
                color="white"
              />
              <Text style={styles.actionText}>
                {inRoute ? 'In route — tap to remove' : 'Add to route'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Website / booking links */}
          {hut.website && (
            <LinkButton
              icon="globe-outline"
              label="Visit hut website"
              onPress={() => Linking.openURL(hut.website!)}
            />
          )}
          {hut.reservationWebsite && (
            <LinkButton
              icon="bed-outline"
              label="Book online"
              onPress={() => Linking.openURL(hut.reservationWebsite!)}
            />
          )}
          {!hut.website && !hut.reservationWebsite && (
            <LinkButton
              icon="bed-outline"
              label="Booking info (hut-reservation.org)"
              onPress={() => Linking.openURL(hut.bookingUrl)}
            />
          )}

          {/* Facilities */}
          <Text style={styles.sectionTitle}>Facilities</Text>
          {facilities.length > 0 ? (
            <View style={styles.facilityGrid}>
              {facilities.map((f) => (
                <View key={f.label} style={styles.facility}>
                  <Ionicons
                    name={f.available ? f.icon : 'close-circle-outline'}
                    size={18}
                    color={f.available ? COLORS.green : '#b0b0b0'}
                  />
                  <Text
                    style={[
                      styles.facilityText,
                      !f.available && styles.facilityMuted,
                    ]}
                  >
                    {f.label}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.noInfo}>
              No facility details recorded in OpenStreetMap for this hut.
            </Text>
          )}

          {/* Contact */}
          {(phone || email) && (
            <>
              <Text style={styles.sectionTitle}>Contact</Text>
              {phone && (
                <TouchableOpacity
                  style={styles.contactRow}
                  onPress={() => Linking.openURL(`tel:${phone}`)}
                >
                  <Ionicons name="call-outline" size={16} color={COLORS.green} />
                  <Text style={styles.contactText}>{phone}</Text>
                </TouchableOpacity>
              )}
              {email && (
                <TouchableOpacity
                  style={styles.contactRow}
                  onPress={() => Linking.openURL(`mailto:${email}`)}
                >
                  <Ionicons name="mail-outline" size={16} color={COLORS.green} />
                  <Text style={styles.contactText}>{email}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* User notes */}
          <Text style={styles.sectionTitle}>Your notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Add your own info — beds, water, hot shower, conditions, anything…"
            placeholderTextColor="#aaa"
            value={notesDraft}
            onChangeText={setNotesDraft}
            onEndEditing={() => setNotes(id, notesDraft)}
            onBlur={() => setNotes(id, notesDraft)}
            multiline
          />

          <View style={styles.coordRow}>
            <Ionicons name="location-outline" size={14} color="#999" />
            <Text style={styles.coordText}>
              {hut.lat.toFixed(4)}, {hut.lon.toFixed(4)}
            </Text>
          </View>
        </View>
      </ScrollView>

      <PhotoGallery
        visible={galleryOpen}
        photos={photos}
        index={galleryIndex}
        userPhotoCount={userPhotos.length}
        onIndexChange={setGalleryIndex}
        onClose={() => setGalleryOpen(false)}
        onRemove={(i) => removeUserPhotoAt(userPhotos[i])}
      />
    </>
  );
}

function PhotoGallery({
  visible,
  photos,
  index,
  userPhotoCount,
  onIndexChange,
  onClose,
  onRemove,
}: {
  visible: boolean;
  photos: HutImage[];
  index: number;
  userPhotoCount: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onRemove: (i: number) => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const current = photos[index];
  const isUserPhoto = index < userPhotoCount;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.galleryRoot}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(_, i) => String(i)}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) =>
            onIndexChange(Math.round(e.nativeEvent.contentOffset.x / width))
          }
          renderItem={({ item }) => (
            <View style={[styles.gallerySlide, { width }]}>
              <Image
                source={{ uri: item.url }}
                style={styles.galleryImage}
                resizeMode="contain"
              />
            </View>
          )}
        />

        <TouchableOpacity
          style={[styles.galleryClose, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={10}
        >
          <Ionicons name="close" size={30} color="white" />
        </TouchableOpacity>

        <View style={[styles.galleryFooter, { paddingBottom: insets.bottom + 14 }]}>
          <Text style={styles.galleryMeta}>
            {index + 1} / {photos.length}
            {current?.credit ? ` · ${current.credit}` : ''}
          </Text>
          {isUserPhoto && (
            <TouchableOpacity onPress={() => onRemove(index)} hitSlop={10}>
              <Ionicons name="trash-outline" size={22} color="#ff6b6b" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function LinkButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.linkBtn} onPress={onPress}>
      <Ionicons name={icon} size={18} color={COLORS.green} />
      <Text style={styles.linkText}>{label}</Text>
      <Ionicons name="open-outline" size={15} color={COLORS.green} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  content: { paddingBottom: 32 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'white',
  },
  missingTitle: { fontSize: 17, fontWeight: '600', color: '#444' },
  link: { color: COLORS.green, fontWeight: '600', fontSize: 15 },
  hero: {},
  photo: { width: '100%', height: 240, backgroundColor: '#eee' },
  cameraBtn: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
  },
  cameraBtnText: { color: 'white', fontSize: 13, fontWeight: '600' },
  countBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  countText: { color: 'white', fontSize: 13, fontWeight: '700' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  placeholderText: { color: '#999', fontSize: 14 },
  credit: {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: 10,
    color: 'white',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  body: { padding: 20, gap: 6 },
  name: { fontSize: 22, fontWeight: '800', color: COLORS.ink },
  meta: { fontSize: 15, color: '#666', marginBottom: 12 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
  },
  actionText: { color: 'white', fontWeight: '800', fontSize: 15 },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.green,
    marginTop: 10,
  },
  linkText: { color: COLORS.green, fontWeight: '600', fontSize: 14 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 22,
    marginBottom: 8,
  },
  facilityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  facility: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f2f5f3',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  facilityText: { fontSize: 13, color: '#333', fontWeight: '500' },
  facilityMuted: { color: '#aaa' },
  noInfo: { fontSize: 13, color: '#999', fontStyle: 'italic' },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  contactText: { fontSize: 14, color: COLORS.green },
  notesInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.ink,
    textAlignVertical: 'top',
  },
  coordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 24,
    justifyContent: 'center',
  },
  coordText: { fontSize: 12, color: '#999' },
  galleryRoot: { flex: 1, backgroundColor: 'black' },
  gallerySlide: { alignItems: 'center', justifyContent: 'center' },
  galleryImage: { width: '100%', height: '100%' },
  galleryClose: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 12,
  },
  galleryMeta: { color: 'white', fontSize: 13 },
});
