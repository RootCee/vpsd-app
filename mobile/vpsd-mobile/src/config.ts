// Switch to local backend for testing, Render for production
const LOCAL = "http://172.20.10.8:8000";  // ← replace with your LAN IP
const RENDER = "https://vpsd-app-1.onrender.com";

export const API_BASE = __DEV__ ? LOCAL : RENDER;