import { confirmSignIn, getCurrentUser, signIn } from "aws-amplify/auth";
import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, Button, StyleSheet, Text, TextInput, View } from "react-native";


export default function SignInScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Shown only when Cognito asks for a new password
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const [busy, setBusy] = useState(false);

  async function onSignIn() {
  if (!username || !password) {
    Alert.alert("Missing info", "Enter Employee ID and password.");
    return;
  }

  setBusy(true);
  try {
    
    try {
      await getCurrentUser();
      router.replace("/(tabs)");
      return;
    } catch {
  // not signed in -> continue
    }

    // 🔵 NOW do the real sign-in
    const res = await signIn({
      username,
      password,
      options: { authFlowType: "USER_PASSWORD_AUTH" },
    });

    console.log("SIGN IN RESULT:", res);

    if ((res as any)?.isSignedIn) {
      router.replace("/(tabs)");
      return;
    }

    const step = (res as any)?.nextStep?.signInStep;
    if (step === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
      setNeedsNewPassword(true);
      Alert.alert("Set new password", "First login requires setting a new password.");
      return;
    }

    Alert.alert("Next step required", String(step ?? "UNKNOWN_NEXT_STEP"));
  } catch (e: any) {
    console.log("SIGN IN ERROR FULL:", e);
    Alert.alert(
      "Sign in failed",
      String(e?.name || e?.code || e?.message || "Unknown error")
    );
  } finally {
    setBusy(false);
  }
}



  async function onConfirmNewPassword() {
    if (!newPassword) {
      Alert.alert("Missing info", "Enter a new password.");
      return;
    }

    setBusy(true);
    try {
      // This completes the NEW_PASSWORD_REQUIRED challenge
      const res = await confirmSignIn({
        challengeResponse: newPassword,
      });

      console.log("CONFIRM SIGN IN RESULT:", res);

      if ((res as any)?.isSignedIn) {
        router.replace("/(tabs)");
        return;
      }

      const step = (res as any)?.nextStep?.signInStep ?? "UNKNOWN_NEXT_STEP";
      Alert.alert("Still needs a step", String(step));
    } catch (e: any) {
      console.log("CONFIRM SIGN IN ERROR FULL:", e);
      Alert.alert(
        "Confirm failed",
        String(e?.name || e?.code || e?.message || "Unknown error")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Sign in</Text>

      {!needsNewPassword ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Employee ID"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <Button
            title={busy ? "Signing in..." : "Sign in"}
            onPress={onSignIn}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <Text style={styles.info}>
            First login: you must set a new password to activate your account.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="New password"
            secureTextEntry
            value={newPassword}
            onChangeText={setNewPassword}
          />

          <Button
            title={busy ? "Confirming..." : "Confirm new password"}
            onPress={onConfirmNewPassword}
            disabled={busy}
          />

          <Button
            title="Back"
            onPress={() => {
              setNeedsNewPassword(false);
              setNewPassword("");
            }}
            disabled={busy}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: "#fff" },
  h1: { fontSize: 22, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 10 },
  info: { opacity: 0.85 },
});
