# VPSD Mobile App - Authentication Testing Guide

## Backend API Endpoints

**Base URL**: https://vpsd-app-1.onrender.com

### Auth Endpoints

#### 1. Register User
```bash
curl -X POST https://vpsd-app-1.onrender.com/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "demo@example.com",
    "password": "password123"
  }'
```

**Expected Response (200)**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "email": "demo@example.com",
    "is_active": true
  }
}
```

**Error Response (400 - Email exists)**:
```json
{
  "detail": "Email already registered"
}
```

**Error Response (400 - Invalid email)**:
```json
{
  "detail": "Valid email is required"
}
```

**Error Response (400 - Password too short)**:
```json
{
  "detail": "Password must be at least 6 characters"
}
```

---

#### 2. Login
```bash
curl -X POST https://vpsd-app-1.onrender.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "demo@example.com",
    "password": "password123"
  }'
```

**Expected Response (200)**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "email": "demo@example.com",
    "is_active": true
  }
}
```

**Error Response (401 - Invalid credentials)**:
```json
{
  "detail": "Invalid email or password"
}
```

**Error Response (403 - Inactive account)**:
```json
{
  "detail": "Account is inactive"
}
```

---

#### 3. Test Protected Endpoint (Triage Queue)
```bash
curl -X GET https://vpsd-app-1.onrender.com/triage/queue \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN_HERE"
```

**Expected Response (200)**:
```json
{
  "items": []
}
```

**Error Response (401 - No token)**:
```json
{
  "detail": "Not authenticated"
}
```

**Error Response (401 - Invalid token)**:
```json
{
  "detail": "Could not validate credentials"
}
```

---

## Mobile App Testing Checklist

### ✅ Registration Flow
- [ ] Open app → Should show login screen
- [ ] Tap "Don't have an account? Register"
- [ ] Enter email: `test@example.com`
- [ ] Enter password: `test123` (should fail - too short)
- [ ] See error: "Password must be at least 6 characters"
- [ ] Enter password: `test1234`
- [ ] Enter confirm password: `test1234`
- [ ] Tap "Create Account"
- [ ] Should redirect to /(tabs)/hotspots
- [ ] Token should be saved in SecureStore

### ✅ Login Flow
- [ ] Logout from app (Triage screen → Logout button)
- [ ] Should redirect to login screen
- [ ] Enter email: `test@example.com`
- [ ] Enter password: `wrong_password`
- [ ] Tap "Login"
- [ ] See error: "Invalid email or password"
- [ ] Enter correct password: `test1234`
- [ ] Tap "Login"
- [ ] Should redirect to /(tabs)/hotspots
- [ ] Token should be saved in SecureStore

### ✅ Token Persistence
- [ ] Close app completely (swipe up from task switcher)
- [ ] Reopen app
- [ ] Should show loading spinner briefly
- [ ] Should automatically go to /(tabs)/hotspots
- [ ] Should NOT require login again

### ✅ Logout Flow
- [ ] Navigate to Triage tab
- [ ] Tap red "Logout" button in header
- [ ] Confirm logout in alert
- [ ] Should redirect to login screen
- [ ] Token should be cleared from SecureStore
- [ ] Tabs should not be accessible

### ✅ Protected Routes
- [ ] After logout, try to manually navigate to /(tabs)
- [ ] Should be blocked and redirected to /login
- [ ] Login again
- [ ] All tabs should be accessible (Hotspots, Triage, Screening)

### ✅ Error Handling
- [ ] Turn off WiFi/cellular
- [ ] Try to login
- [ ] Should see: "Network error. Please check your connection and try again."
- [ ] Turn on WiFi/cellular
- [ ] Try to register with existing email
- [ ] Should see: "Email already registered"
- [ ] Try to login with non-existent email
- [ ] Should see: "Invalid email or password"

---

## Debug Logs (Development Mode)

When running in development, you should see console logs:

### App Start:
```
[AuthContext] loadToken - token exists: true
[index.tsx] isAuthenticated: true isLoading: false
[_layout.tsx] segments: ["(tabs)", "hotspots"] isAuthenticated: true inAuthGroup: false
```

### Login:
```
[login.tsx] Login successful
[AuthContext] Attempting login for: demo@example.com
[AuthContext] API_BASE: https://vpsd-app-1.onrender.com
[AuthContext] Login response status: 200
[AuthContext] Login response data: { hasAccessToken: true, hasUser: true }
[AuthContext] Login successful, token saved
[_layout.tsx] segments: ["login"] isAuthenticated: true inAuthGroup: true
```

### Logout:
```
[triage/index.tsx] Logging out...
[AuthContext] Logging out, clearing token
[AuthContext] Logout complete
[_layout.tsx] segments: ["(tabs)", "triage"] isAuthenticated: false inAuthGroup: false
```

---

## Quick Demo User Setup

### Option 1: Use curl (from terminal)
```bash
curl -X POST https://vpsd-app-1.onrender.com/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "demo@vpsd.app", "password": "demo123"}'
```

### Option 2: Use Dev Helper (in app, development mode only)
- On login screen, long press the login button for 3 seconds
- A dev menu will appear with "Create Demo User" option
- This creates: `demo@vpsd.app` / `demo123`

---

## Common Issues

### Issue: "Network error"
**Cause**: Backend is down or network unreachable
**Fix**:
1. Check if backend is up: `curl https://vpsd-app-1.onrender.com/health`
2. Check your network connection
3. If on simulator, ensure laptop has internet

### Issue: "Email already registered"
**Cause**: User already exists in database
**Fix**: Use a different email or login with existing credentials

### Issue: "Could not validate credentials"
**Cause**: JWT token is expired or invalid
**Fix**: Logout and login again

### Issue: App shows tabs without login
**Cause**: Old token still in SecureStore
**Fix**:
1. Logout from app
2. Or clear app data (iOS: delete and reinstall, Android: Settings → Apps → VPSD → Clear Data)

---

## API Response Format

All auth endpoints return consistent format:

**Success**:
```json
{
  "access_token": "JWT_TOKEN_STRING",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "is_active": true
  }
}
```

**Error**:
```json
{
  "detail": "Human-readable error message"
}
```

Status codes:
- `200`: Success
- `400`: Bad request (validation error)
- `401`: Unauthorized (invalid credentials)
- `403`: Forbidden (inactive account)
- `500`: Internal server error
