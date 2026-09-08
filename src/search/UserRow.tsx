// One person in a search result list.
//
// Avatar, name, handle, and the first line of their bio — the four things that let you tell
// two accounts with similar names apart. No counts: a result row is a way to reach a
// profile, and the profile is where the numbers live.
import { View, Text, Pressable } from "react-native";
import { font, themedStyles } from "../theme";
import Avatar, { tintFor } from "../ui/Avatar";
import type { UserSummary } from "../../api/client";

export default function UserRow({
  user,
  onPress,
  onRemove,
}: {
  user: UserSummary;
  onPress: (user: UserSummary) => void;
  /** Present only in the recent list — a search result is not something you can forget. */
  onRemove?: (user: UserSummary) => void;
}) {
  const s = useStyles();
  const name = user.displayName ?? user.username ?? "";

  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      onPress={() => onPress(user)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, @${user.username}`}
    >
      {/* Tinted from the handle, like the comment list — two people with no photo are still
          two different discs rather than one repeated shape down the whole list. */}
      <Avatar uri={user.avatarUrl} name={name} size={46} tint={tintFor(user.username)} />

      <View style={s.text}>
        <Text style={s.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={s.handle} numberOfLines={1}>
          @{user.username}
        </Text>
        {user.bio ? (
          <Text style={s.bio} numberOfLines={1}>
            {user.bio}
          </Text>
        ) : null}
      </View>

      {/*
        A row you can remove ends in the control that removes it, not in a chevron that
        says "forward" beside a button that means "delete". The chevron stays on search
        results, where forward is the only thing the row does.
      */}
      {onRemove ? (
        <Pressable
          onPress={() => onRemove(user)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name} from recent searches`}
        >
          <Text style={s.remove}>✕</Text>
        </Pressable>
      ) : (
        <Text style={s.chevron}>›</Text>
      )}
    </Pressable>
  );
}

const useStyles = themedStyles(({ c }) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  // A list row has no border and no shadow, so without this a tap has no acknowledgement
  // at all on the frames before the next screen appears.
  rowPressed: { backgroundColor: c.w06 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: font.sans, fontSize: 14, fontWeight: "600", color: c.text },
  handle: { fontFamily: font.mono, fontSize: 11.5, color: c.w42 },
  bio: { fontFamily: font.sans, fontSize: 12, color: c.w50, marginTop: 1 },
  chevron: { fontFamily: font.sans, fontSize: 20, color: c.w30 },
  remove: { fontFamily: font.sans, fontSize: 13, color: c.w38 },
}));
