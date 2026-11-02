import React, { useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, StyleSheet, View } from "react-native";
import { Reply } from "lucide-react-native";
import { useTheme } from "../../context/ThemeContext";
import { lightHaptic } from "../../utils/haptics";
import {
  SWIPE_REPLY_TRIGGER_PX,
  hasReachedTrigger,
  shouldStartSwipe,
  swipeOffset,
} from "../../utils/swipeReply";

interface SwipeToReplyProps {
  /** Off for messages that cannot be quoted (deleted, failed): the gesture is ignored, the tree stays the same. */
  enabled: boolean;
  /** Called once when the finger is released past the trigger distance. */
  onReply: () => void;
  testID?: string;
  children: React.ReactNode;
}

/**
 * WhatsApp-style "swipe a message to the right to reply".
 *
 * Built on React Native's own PanResponder and Animated (no extra native module). The gesture only takes over a clear
 * horizontal move, so vertical scrolling and the long-press on the bubble keep working. A child that must keep
 * horizontal drags for itself (for example a seek bar) can refuse the hand-over with onResponderTerminationRequest.
 */
export const SwipeToReply: React.FC<SwipeToReplyProps> = ({ enabled, onReply, testID, children }) => {
  const { colors: Colors } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  // Read through refs so the PanResponder (created once) never uses stale props.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const reachedRef = useRef(false);

  const springBack = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => enabledRef.current && shouldStartSwipe(g.dx, g.dy),
        onPanResponderGrant: () => {
          reachedRef.current = false;
        },
        onPanResponderMove: (_e, g) => {
          translateX.setValue(swipeOffset(g.dx));
          const reached = hasReachedTrigger(g.dx);
          // One light tap the moment the trigger distance is crossed; none when the finger moves back and forth.
          if (reached && !reachedRef.current) lightHaptic();
          reachedRef.current = reached;
        },
        onPanResponderRelease: (_e, g) => {
          const fire = enabledRef.current && hasReachedTrigger(g.dx);
          reachedRef.current = false;
          springBack();
          if (fire) onReplyRef.current();
        },
        onPanResponderTerminate: () => {
          reachedRef.current = false;
          springBack();
        },
        // Once the swipe has started, nothing (such as the list) may take the touch away mid-gesture.
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [translateX],
  );

  // A message that stops being swipeable mid-gesture (deleted by the sender) must not stay shifted.
  useEffect(() => {
    if (!enabled) translateX.setValue(0);
  }, [enabled, translateX]);

  const iconOpacity = translateX.interpolate({
    inputRange: [0, SWIPE_REPLY_TRIGGER_PX * 0.4, SWIPE_REPLY_TRIGGER_PX],
    outputRange: [0, 0.5, 1],
    extrapolate: "clamp",
  });
  const iconScale = translateX.interpolate({
    inputRange: [0, SWIPE_REPLY_TRIGGER_PX],
    outputRange: [0.6, 1],
    extrapolate: "clamp",
  });

  return (
    <View testID={testID}>
      <Animated.View
        pointerEvents="none"
        style={[styles.iconSlot, { opacity: iconOpacity, transform: [{ scale: iconScale }] }]}
        testID={testID ? `${testID}-icon` : undefined}
      >
        <View style={[styles.iconCircle, { backgroundColor: Colors.card, borderColor: Colors.border }]}>
          <Reply size={16} color={Colors.mutedForeground} />
        </View>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  iconSlot: {
    position: "absolute",
    left: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
