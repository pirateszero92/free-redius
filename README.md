# FreeRADIUS Manager — Docker Setup Guide

## 🚀 Quick Start

```bash
# 1. Clone and enter directory
cd free-redius

# 2. Copy environment file
cp .env.example .env

# 3. Edit .env if needed (optional — defaults work out of the box)
# notepad .env

# 4. Build and start all services
docker compose up -d --build

# 5. Wait ~30 seconds for services to initialize, then open:
# http://localhost:8080

# Default login: admin / Admin@1234
```

## 📦 Services

| Service | Port | Description |
|---|---|---|
| nginx | 8080 | Web UI + API reverse proxy |
| api | 3000 (internal) | Node.js REST API |
| freeradius | 1812/udp, 1813/udp | RADIUS server |
| postgres | 5432 (internal) | Database |

## 🌐 Web UI Pages

| Page | Description |
|---|---|
| Dashboard | Stats, active sessions, auth chart |
| Users | RADIUS users with group assignment |
| Groups | RADIUS groups with check/reply attributes |
| ACL Profiles | Predefined access control policies (VLAN, Cisco, Aruba) |
| NAS Clients | Network Access Servers (routers, APs) |
| Accounting | Session logs & auth event logs |
| Settings → AD | Active Directory sync (configurable via UI) |
| Settings → General | Site settings |
| Settings → Admin Users | Manage web UI admin accounts |

## 🏢 Active Directory Integration

1. Go to **Settings → Active Directory**
2. Fill in LDAP settings (host, port, bind DN, password, base DN)
3. Click **Test Connection** to verify
4. Click **Save Settings**
5. Click **Load AD Groups** to see available groups
6. Select groups to sync, then click **Sync Now**

> AD settings are stored in PostgreSQL and can be changed at any time without restarting containers.

## 🔑 Default Credentials

- **Web UI**: `admin` / `Admin@1234`
- **Change at**: Settings → Change Password

## 🛠️ Common Commands

```bash
# View logs
docker compose logs -f api
docker compose logs -f freeradius

# Restart services
docker compose restart api

# Stop all
docker compose down

# Stop and remove data
docker compose down -v

# Rebuild after code changes
docker compose up -d --build api
```

## 📡 Test RADIUS Authentication (radtest)

```bash
# From inside freeradius container
docker exec -it freeradius-server radtest testuser testpassword 127.0.0.1 0 testing123
```

## 🗄️ Database Access

```bash
docker exec -it freeradius-postgres psql -U radius -d radius
```
