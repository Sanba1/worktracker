import { fetchAuthSession } from "aws-amplify/auth";

const API_BASE = "https://1o6go1bghj.execute-api.us-east-1.amazonaws.com/dev";

export type Workplace = {
  workplaceId: string;
  name: string;
  center: { lat: number; lng: number };
  radiusMeters: number;
  capMinutes: number;
  active: boolean;
  tasks?: string[];
  updatedAtMs?: number;
};

async function getBearerToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token =
    session.tokens?.idToken?.toString() || // usually best for API Gateway Cognito authorizer
    session.tokens?.accessToken?.toString();

  if (!token) throw new Error("No Cognito token found. Are you signed in?");
  return token;
}

export async function getWorkplaces(): Promise<Workplace[]> {
  const token = await getBearerToken();

  const res = await fetch(`${API_BASE}/workplaces`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  return json.items ?? [];
}
