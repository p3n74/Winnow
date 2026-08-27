export type CursorAccountSnapshot = {
  loggedIn: boolean;
  email: string;
  userId?: string;
  subscriptionTier: string;
  cliVersion: string;
  updateMessage: string;
  needsLogin: boolean;
};

export function parseCursorStatusPayload(raw: string): { loggedIn: boolean; email: string; userId?: string } {
  const text = String(raw || "").trim();
  try {
    const data = JSON.parse(text) as {
      status?: string;
      isAuthenticated?: boolean;
      userInfo?: { email?: string; userId?: number | string };
    };
    const email = String(data.userInfo?.email || "").trim();
    const loggedIn = data.isAuthenticated === true || data.status === "authenticated";
    const userId = data.userInfo?.userId === undefined ? undefined : String(data.userInfo.userId);
    return { loggedIn, email, userId };
  } catch {
    const lower = text.toLowerCase();
    const loggedIn = /logged in as\s+\S+/i.test(text) && !/not logged in/i.test(lower);
    const email = text.match(/logged in as\s+(\S+)/i)?.[1]?.trim() || "";
    return { loggedIn, email };
  }
}

export function parseCursorAboutPayload(raw: string): {
  email: string;
  subscriptionTier: string;
  cliVersion: string;
} {
  const text = String(raw || "").trim();
  try {
    const data = JSON.parse(text) as {
      userEmail?: string;
      subscriptionTier?: string;
      cliVersion?: string;
    };
    return {
      email: String(data.userEmail || "").trim(),
      subscriptionTier: String(data.subscriptionTier || "").trim(),
      cliVersion: String(data.cliVersion || "").trim(),
    };
  } catch {
    const email = text.match(/User Email\s+(\S+)/i)?.[1]?.trim() || "";
    const subscriptionTier = text.match(/Subscription Tier\s+(\S.+)$/im)?.[1]?.trim() || "";
    const cliVersion = text.match(/CLI Version\s+(\S+)/i)?.[1]?.trim() || "";
    return { email, subscriptionTier, cliVersion };
  }
}

export function parseCursorUpdateOutput(raw: string): { upToDate: boolean; needsLogin: boolean; message: string } {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  const needsLogin =
    lower.includes("authentication required") ||
    lower.includes("not logged in") ||
    lower.includes("please run 'agent login'") ||
    lower.includes("please run \"agent login\"");
  const upToDate = /already up to date/i.test(text);
  return {
    upToDate,
    needsLogin,
    message: text || (upToDate ? "Already up to date" : ""),
  };
}

export function extractLoginUrl(raw: string): string {
  const match = String(raw || "").match(/https?:\/\/[^\s]+/i);
  return match?.[0] || "";
}

export function mergeCursorAccount(input: {
  status?: ReturnType<typeof parseCursorStatusPayload>;
  about?: ReturnType<typeof parseCursorAboutPayload>;
  update?: ReturnType<typeof parseCursorUpdateOutput>;
}): CursorAccountSnapshot {
  const loggedIn = Boolean(input.status?.loggedIn);
  const email = input.status?.email || input.about?.email || "";
  const needsLogin = !loggedIn;
  return {
    loggedIn,
    email,
    userId: input.status?.userId,
    subscriptionTier: input.about?.subscriptionTier || "",
    cliVersion: input.about?.cliVersion || "",
    updateMessage: input.update?.message || "",
    needsLogin,
  };
}
