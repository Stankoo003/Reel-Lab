// One user's profile header, rendered either read-only or as an edit form.
//
// The same component does both so the two can never drift apart — a field shown when
// viewing but missing when editing would be a bug you only find by switching. Which mode it
// is in comes from `editable`, decided by the caller.
//
// Design 3a draws this as bare content on the page rather than inside a panel, so there is
// no Card here; the settings blocks below it on the profile screen keep theirs.
import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { button, font, isIOS, themedStyles, useTheme } from "../theme";
import { compactCount } from "../format";
import { errorMessage } from "../errors";
import { ValidationError, updateProfile, uploadAvatar } from "../../api/client";
import Avatar from "../ui/Avatar";
import Button from "../ui/Button";
import Field from "../ui/Field";
import StatGrid from "../ui/StatGrid";
import type { FieldErrors, Profile } from "../../api/client";

const MAX_BIO = 500;
const MAX_DISPLAY_NAME = 100;

export default function ProfileCard({
  profile,
  editable,
  onSaved,
}: {
  profile: Profile;
  /**
   * True only for the viewer's own profile. Everyone else's is read-only — there is no
   * authentication yet, so this is a UI rule the server cannot enforce; see UserService.
   */
  editable: boolean;
  onSaved: (updated: Profile) => void;
}) {
  const { c, type } = useTheme();
  const s = useStyles();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  /** Set once a new avatar is picked and uploaded; null means "keep the current one". */
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** Keyed by field name, straight from the server's ProblemDetail `errors`. */
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  // A different profile means a different form. Without this, opening someone else's
  // profile would show the previous one's draft.
  useEffect(() => {
    setEditing(false);
    setDisplayName(profile.displayName ?? "");
    setBio(profile.bio ?? "");
    setAvatarPath(null);
    setPreview(null);
    setFieldErrors({});
    setFormError(null);
  }, [profile.id, profile.displayName, profile.bio]);

  async function pickAvatar() {
    setFormError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        allowsEditing: true,
        // Square, because that is how it is displayed; cropping here beats letting the
        // server store something that only looks right in one place.
        aspect: [1, 1],
        // Re-encodes to something small. The server's 512KB cap is the real limit — this
        // only saves a doomed round trip for a 12-megapixel photo.
        quality: 0.7,
      });
      if (picked.canceled) return;

      const uri = picked.assets[0].uri;
      setPreview(uri);
      setUploading(true);
      setAvatarPath(await uploadAvatar(uri));
    } catch (e) {
      // The server's reason — wrong type, too large — comes through here.
      setPreview(null);
      setAvatarPath(null);
      setFormError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (saving || uploading) return;
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const updated = await updateProfile(profile.id ?? "", { displayName, bio, avatarPath });
      onSaved(updated);
      setEditing(false);
      setPreview(null);
      setAvatarPath(null);
    } catch (e) {
      if (e instanceof ValidationError) {
        // Attached to the inputs below rather than shown as one sentence over the form.
        setFieldErrors(e.fields);
        // Only surface the summary when nothing could be attached to a field, or it would
        // say the same thing twice.
        if (Object.keys(e.fields).length === 0) setFormError(e.message);
      } else {
        setFormError(errorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setEditing(false);
    setDisplayName(profile.displayName ?? "");
    setBio(profile.bio ?? "");
    setAvatarPath(null);
    setPreview(null);
    setFieldErrors({});
    setFormError(null);
  }

  const avatarSource = preview ?? profile.avatarUrl ?? null;
  const activity = profile.activity;

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Avatar
          uri={avatarSource}
          name={profile.displayName ?? profile.username}
          size={72}
          // The owner's own disc is always accent in the design; only the comment list
          // varies its tint to tell speakers apart.
          tint={c.accent}
          busy={uploading}
        />

        <View style={s.identity}>
          {editing ? (
            <Field
              label="DISPLAY NAME"
              value={displayName}
              onChangeText={setDisplayName}
              error={fieldErrors.displayName}
              maxLength={MAX_DISPLAY_NAME}
            />
          ) : (
            <>
              <Text style={type.profileName} numberOfLines={2}>
                {profile.displayName ?? "—"}
              </Text>
              {/*
                The design carries a role-and-place line here ("Field service · Novi Sad").
                No such field exists on the profile record, so the row holds its place with
                an em dash rather than showing something the server never said.
              */}
              <Text style={s.subtitle}>—</Text>
              {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}
            </>
          )}
        </View>
      </View>

      {editing ? (
        <>
          <Button label={uploading ? "Uploading…" : "Change avatar"} onPress={pickAvatar} disabled={uploading} />

          <Field
            label="BIO"
            value={bio}
            onChangeText={setBio}
            error={fieldErrors.bio}
            maxLength={MAX_BIO}
            multiline
          />
          {/* Shown always, not only once exceeded — the limit is part of the field. */}
          <Text style={type.note}>
            {bio.length}/{MAX_BIO}
          </Text>

          {/* An avatar rejected by the server lands here; it has no input of its own. */}
          {fieldErrors.avatarPath ? <Text style={type.error}>{fieldErrors.avatarPath}</Text> : null}
          {formError ? <Text style={type.error}>{formError}</Text> : null}

          <View style={s.actions}>
            <Button
              label={saving ? "Saving…" : "Save"}
              onPress={save}
              variant="primary"
              size="compact"
              grow
              disabled={saving || uploading}
            />
            <Button label="Cancel" onPress={cancel} size="compact" />
          </View>
        </>
      ) : (
        <>
          <StatGrid
            stats={[
              { label: "VIDEOS", value: compactCount(activity?.publishedVideos ?? 0) },
              // No view tracking exists on the server — see VideoResponse. The slot is the
              // design's; the value is honest about being absent.
              { label: "VIEWS", value: "—" },
              { label: "LIKES", value: compactCount(activity?.likesReceived ?? 0) },
            ]}
          />

          {/* Absent, not disabled, on someone else's profile. */}
          {editable ? (
            <View style={s.actions}>
              <Button
                label="Edit profile"
                onPress={() => setEditing(true)}
                variant="primary"
                size="compact"
                grow
              />
              <Pressable
                style={s.more}
                accessibilityRole="button"
                accessibilityLabel="More profile options"
                // No destination yet — the design shows the affordance, and the screens
                // behind it are not part of this change.
                onPress={() => {}}
              >
                <Text style={s.moreText}>•••</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const useStyles = themedStyles(({ c }) => ({
  wrap: { gap: 14 },
  head: { flexDirection: "row", gap: 15, alignItems: "center" },
  identity: { flex: 1, minWidth: 0 },
  subtitle: { fontFamily: font.mono, fontSize: 12, color: c.w42, marginTop: 4 },
  bio: { fontFamily: font.sans, fontSize: 12.5, lineHeight: 12.5 * 1.45, color: c.w60, marginTop: 7 },
  actions: { flexDirection: "row", gap: 10 },
  // Sized to sit level with the compact button beside it, and shaped by the same platform
  // rule the theme applies to every other control.
  more: {
    width: isIOS ? 52 : 54,
    height: button.compactHeight,
    borderRadius: button.compactRadius,
    borderWidth: 1,
    borderColor: c.w16,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: { fontFamily: font.mono, fontSize: 9.5, fontWeight: "500", color: c.w60 },
}));
