import { getWorkplaces } from "@/src/api";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import * as Location from "expo-location";
import { router } from "expo-router"; //for sign-in button 
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, ScrollView, StyleSheet, Text, View } from "react-native";




// 1) Hardcoded workplace for now (replace later with AWS config)
const WORKPLACE = {
  name: "Test Workplace",
  center: { lat: 55.786781, lng: 12.523153}, // dtu center example
  radiusMeters: 150,
  capMinutes: 1, // 12 hours safety cap
};

type SessionState = "IDLE" | "RUNNING" | "PAUSED_OUTSIDE" | "STOPPED";

type Session = {
  startedAtMs: number | null;
  state: SessionState;
  workedMs: number; // accumulated active time
  lastResumedAtMs: number | null; // when we last entered RUNNING
  capReached: boolean;
};
type EventType =
  | "START"
  | "PAUSE_OUTSIDE"
  | "RESUME_INSIDE"
  | "STOP_USER"
  | "STOP_CAP";

type WorkEvent = {
  eventId: string;        // UUID
  type: EventType;
  atMs: number;           // Date.now()
  employeeId?: string;    // add later from Cognito
  locationId?: string;    // add later from AWS config
  sessionId: string;      // stable per session
  payload?: Record<string, unknown>;
};


function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000; // meters
  const toRad = (x: number) => (x * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function formatMs(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

export default function HomeScreen() {
  const [workplace, setWorkplace] = useState(WORKPLACE);

  const [permissionStatus, setPermissionStatus] = useState<Location.PermissionStatus | "unknown">(
    "unknown"
  );
  const capLoggedRef = useRef(false);

  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const [session, setSession] = useState<Session>({
    startedAtMs: null,
    state: "IDLE",
    workedMs: 0,
    lastResumedAtMs: null,
    capReached: false,
  });

  // Timer tick for UI and cap enforcement (runs only while RUNNING)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const capMs = useMemo(() => workplace.capMinutes * 60 * 1000, [workplace.capMinutes]);

  const distanceInfo = useMemo(() => {
    if (!currentCoords) return null;
    const d = haversineMeters(currentCoords, workplace.center);
    return {
      meters: d,
      inside: d <= workplace.radiusMeters,
    };
  }, [currentCoords]);

  const effectiveWorkedMs = useMemo(() => {
    if (session.state !== "RUNNING" || session.lastResumedAtMs === null) return session.workedMs;
    const now = Date.now();
    return session.workedMs + (now - session.lastResumedAtMs);
  }, [session]);

  const [sessionId, setSessionId] = useState<string>(() =>
  (globalThis.crypto?.randomUUID?.() ?? `sess_${Date.now()}`)
  );
  const [events, setEvents] = useState<WorkEvent[]>([]);
  const activeSessionIdRef = useRef(sessionId);

  const [awsNames, setAwsNames] = useState<string>("");
  



  function stopTick() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function newId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}_${Date.now()}_${Math.random()}`;
}

  function pushEvent(type: EventType, payload?: Record<string, unknown>,overrideSessionId?: string) {
  const event: WorkEvent = {
    eventId: newId("evt"),
    type,
    atMs: Date.now(),
    sessionId: overrideSessionId ?? sessionId,
    payload,
  };
  setEvents((prev) => [...prev, event]);
}


  function startTick() {
    stopTick();
    tickRef.current = setInterval(() => {
      // Cap enforcement: if running too long, force stop
      setSession((prev) => {
        if (prev.state !== "RUNNING" || prev.lastResumedAtMs === null) return prev;
        const now = Date.now();
        const worked = prev.workedMs + (now - prev.lastResumedAtMs);
        if (worked >= capMs) {
          // Force stop at cap
          return {
            ...prev,
            state: "STOPPED",
            workedMs: capMs,
            lastResumedAtMs: null,
            capReached: true,
          };
        }
        return prev; // keep running
      });
    }, 1000);
  }

  useEffect(() => {
    // start/stop timer ticking based on session state
    if (session.state === "RUNNING") startTick();
    else stopTick();

    return () => stopTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.state]);

  useEffect(() => {
  activeSessionIdRef.current = sessionId;
}, [sessionId]);

  useEffect(() => {
  if (session.capReached && !capLoggedRef.current) {
    capLoggedRef.current = true;
    pushEvent("STOP_CAP", undefined, activeSessionIdRef.current);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [session.capReached]);


  async function requestPermission() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermissionStatus(status);
    if (status !== "granted") {
      Alert.alert("Permission needed", "Location permission is required to start work on-site.");
    }
  }

  async function refreshLocation() {
    const status = await Location.getForegroundPermissionsAsync();
    setPermissionStatus(status.status);
    if (status.status !== "granted") {
      Alert.alert("No permission", "Grant location permission first.");
      return;
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    setCurrentCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    setAccuracy(pos.coords.accuracy ?? null);
  }

  function startSession() {
    if (!distanceInfo) {
      Alert.alert("No location yet", "Tap 'Refresh location' first.");
      return;
    }
    if (!distanceInfo.inside) {
      Alert.alert(
        "Not on-site",
        `You must be inside the workplace circle to start.\nDistance: ${distanceInfo.meters.toFixed(
          1
        )}m (radius ${WORKPLACE.radiusMeters}m)`
      );
      return;
    }
    const sid = newId("sess");

    setSessionId(sid);
    capLoggedRef.current = false;

    pushEvent(
  "START",
  {
    distanceMeters: distanceInfo.meters,
    radiusMeters: WORKPLACE.radiusMeters,
  },
  sid
);

    setSession({
      startedAtMs: Date.now(),
      state: "RUNNING",
      workedMs: 0,
      lastResumedAtMs: Date.now(),
      capReached: false,
    });
  }

  function stopSessionUser() {
  if (session.state === "IDLE") return; // nothing to stop

  pushEvent("STOP_USER", undefined, activeSessionIdRef.current);

  setSession((prev) => {
    if (prev.state === "RUNNING" && prev.lastResumedAtMs !== null) {
      const now = Date.now();
      const worked = prev.workedMs + (now - prev.lastResumedAtMs);
      return {
        ...prev,
        state: "STOPPED",
        workedMs: Math.min(worked, capMs),
        lastResumedAtMs: null,
      };
    }
    return { ...prev, state: "STOPPED", lastResumedAtMs: null };
  });
}


  // Simulate geofence EXIT (pause)
  function simulateExit() {
    if (session.state !== "RUNNING" || session.lastResumedAtMs === null) return;

    pushEvent("PAUSE_OUTSIDE");

    setSession((prev) => {
      if (prev.state !== "RUNNING" || prev.lastResumedAtMs === null) return prev;
      
      const now = Date.now();
      const worked = prev.workedMs + (now - prev.lastResumedAtMs);
      return {
        ...prev,
        state: "PAUSED_OUTSIDE",
        workedMs: Math.min(worked, capMs),
        lastResumedAtMs: null,
      };
    });
  }

  // Simulate geofence ENTER (resume)
  function simulateEnter() {
    if (session.state !== "PAUSED_OUTSIDE") return;

    pushEvent("RESUME_INSIDE");
    
    setSession((prev) => {
      if (prev.state !== "PAUSED_OUTSIDE") return prev;
      
      if (prev.workedMs >= capMs) {
        return { ...prev, state: "STOPPED", capReached: true };
      }
      return {
        ...prev,
        state: "RUNNING",
        lastResumedAtMs: Date.now(),
      };
    });
  }

  // Reset everything
  function reset() {
  const sid = newId("sess");
  setSessionId(sid);
  capLoggedRef.current = false;

  setSession({
    startedAtMs: null,
    state: "IDLE",
    workedMs: 0,
    lastResumedAtMs: null,
    capReached: false,
  });

  setEvents([]); // keep clean per run while developing
  setCurrentCoords(null);
  setAccuracy(null);
}
async function whoAmI() {
  try {
    const u = await getCurrentUser();
    console.log("CURRENT USER:", u);
    Alert.alert("Current user", u.username);
  } catch {
    Alert.alert("Current user", "Not signed in");
  }
}

async function logout() {
  await signOut();
  Alert.alert("Signed out", "You are now signed out");
  router.replace("/sign-in");
}

async function loadWorkplacesFromAws() {
  try {
    const items = await getWorkplaces();
    setAwsNames(items.map((w) => w.name).join(", "));

    if (items.length > 0) {
      setWorkplace(items[0]); // for now, just pick first workplace
    }

    Alert.alert("AWS OK", `Loaded ${items.length} workplace(s)`);
  } catch (e: any) {
    Alert.alert("AWS Load failed", e?.message ?? "Unknown error");
  }
}







  return (
    <ScrollView style={styles.container}>
      <Text style={styles.h1}>WorkTracker v0</Text>

      <View style={styles.card}>
        <Text style={styles.h2}>Workplace</Text>
        <Text>Name: {WORKPLACE.name}</Text>
        <Text>
          Center: {WORKPLACE.center.lat}, {WORKPLACE.center.lng}
        </Text>
        <Text>Radius: {WORKPLACE.radiusMeters}m</Text>
        <Text>Session cap: {WORKPLACE.capMinutes} minute(s)</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Permissions</Text>
        <Text>Status: {permissionStatus}</Text>
        <Button title="Request location permission" onPress={requestPermission} />
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Current location</Text>
        <Text>
          {currentCoords
            ? `Lat: ${currentCoords.lat.toFixed(6)}, Lng: ${currentCoords.lng.toFixed(6)}`
            : "No location yet"}
        </Text>
        <Text>Accuracy: {accuracy ? `${accuracy.toFixed(1)}m` : "unknown"}</Text>
        <Button title="Refresh location" onPress={refreshLocation} />
        <Text style={styles.small}>
          {distanceInfo
            ? `Distance to center: ${distanceInfo.meters.toFixed(1)}m • ${
                distanceInfo.inside ? "INSIDE ✅" : "OUTSIDE ❌"
              }`
            : "Distance: (refresh location first)"}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Session</Text>
        <Text>State: {session.state}</Text>
        <Text>Worked: {formatMs(effectiveWorkedMs)}</Text>
        <Text>Cap reached: {session.capReached ? "Yes" : "No"}</Text>

        <View style={styles.row}>
          <Button title="Start (must be inside)" onPress={startSession} />
          <Button title="Stop (user)" onPress={stopSessionUser} />
        </View>

        <View style={styles.row}>
          <Button title="Simulate EXIT (pause)" onPress={simulateExit} />
          <Button title="Simulate ENTER (resume)" onPress={simulateEnter} />
        </View>

        <View style={styles.row}>
          <Button title="Reset" onPress={reset} />
          <Button title="Who am I?" onPress={whoAmI} />
          <Button title="Load workplaces from AWS" onPress={loadWorkplacesFromAws} />
          <Button title="Logout" onPress={logout} />
        </View>

        <Text style={styles.small}>AWS workplaces: {awsNames || "(none loaded)"}</Text>

        <Text style={styles.small}>
          Note: EXIT/ENTER are simulated because we don’t have a physical device setup yet. Later,
          these will be triggered by real geofence events.
        </Text>
      </View>
    </ScrollView>
  );

}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: "#fff" },
  h1: { fontSize: 22, fontWeight: "700" },
  h2: { fontSize: 16, fontWeight: "700", marginBottom: 6 },
  card: {
  padding: 12,
  borderWidth: 1,
  borderRadius: 10,
  gap: 8,
  borderColor: "#ddd",
  backgroundColor: "#fafafa",
},

  row: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 10,
  justifyContent: "space-between",
},

  small: { opacity: 0.8, marginTop: 4 },
});
