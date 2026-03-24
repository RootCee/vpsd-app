// Always use Render for production builds
export const API_BASE = "https://vpsd-app-1.onrender.com";

// Opt-in dev tools so they stay hidden in normal development and all production builds.
export const SHOW_DEV_TOOLS = __DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEV_TOOLS === "1";
