import { COGNITO_CLIENT_ID, COGNITO_REGION } from "./config";

// 直接呼叫 Cognito User Pool 的 REST API，不用 Amplify
const ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
const STORAGE_KEY = "ubike.session";

interface Session {
  email: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number; // ms
}

const ERRORS: Record<string, string> = {
  UsernameExistsException: "這個 Email 已經註冊過了",
  UserNotFoundException: "帳號或密碼錯誤",
  NotAuthorizedException: "帳號或密碼錯誤",
  UserNotConfirmedException: "帳號尚未完成 Email 驗證",
  CodeMismatchException: "驗證碼錯誤",
  ExpiredCodeException: "驗證碼已過期，請重新寄送",
  InvalidPasswordException: "密碼至少 8 碼且需包含數字",
  InvalidParameterException: "輸入格式有誤",
  LimitExceededException: "嘗試次數太多，請稍後再試",
  TooManyRequestsException: "嘗試次數太多，請稍後再試",
};

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(target: string, body: object): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify({ ClientId: COGNITO_CLIENT_ID, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data.__type ?? "").split("#").pop() ?? "Unknown";
    throw new AuthError(code, ERRORS[code] ?? data.message ?? "登入服務發生錯誤");
  }
  return data as T;
}

function load(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function save(s: Session | null) {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 無痕模式等情況存不了就算了，只是要重新登入 */
  }
}

let session = load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const onAuthChange = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const currentEmail = () => session?.email ?? null;

export function signUp(email: string, password: string) {
  return call("SignUp", {
    Username: email,
    Password: password,
    UserAttributes: [{ Name: "email", Value: email }],
  });
}

export function confirmSignUp(email: string, code: string) {
  return call("ConfirmSignUp", { Username: email, ConfirmationCode: code });
}

export function resendCode(email: string) {
  return call("ResendConfirmationCode", { Username: email });
}

interface AuthResult {
  AuthenticationResult: { IdToken: string; RefreshToken?: string; ExpiresIn: number };
}

export async function signIn(email: string, password: string) {
  const r = await call<AuthResult>("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  const a = r.AuthenticationResult;
  session = {
    email,
    idToken: a.IdToken,
    refreshToken: a.RefreshToken ?? "",
    expiresAt: Date.now() + a.ExpiresIn * 1000,
  };
  save(session);
  emit();
}

export function signOut() {
  session = null;
  save(null);
  emit();
}

/** 取得有效的 IdToken（快過期會自動換新）；未登入回傳 null */
export async function getIdToken(): Promise<string | null> {
  if (!session) return null;
  if (Date.now() < session.expiresAt - 60_000) return session.idToken;
  try {
    const r = await call<AuthResult>("InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: { REFRESH_TOKEN: session.refreshToken },
    });
    session = {
      ...session,
      idToken: r.AuthenticationResult.IdToken,
      expiresAt: Date.now() + r.AuthenticationResult.ExpiresIn * 1000,
    };
    save(session);
    return session.idToken;
  } catch {
    signOut();
    return null;
  }
}
