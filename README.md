# FreeRADIUS Manager — Enterprise Docker Setup & User Manual

An enterprise-grade, dockerized FreeRADIUS management system with web-based administration console, automatic Active Directory (AD) synchronization, dynamic VLAN routing, and MAC Authentication Bypass (MAB) device registry.

---

## 🖼️ Web Portal Screenshots

<p align="center">
  <img src="docs/images/dashboard.png" width="48%" alt="Dashboard" />
  <img src="docs/images/devices_list.png" width="48%" alt="Device Registry" />
</p>
<p align="center">
  <img src="docs/images/system_logs.png" width="48%" alt="System Logs Search" />
  <img src="docs/images/admin_users.png" width="48%" alt="Admin Users" />
</p>
<p align="center">
  <img src="docs/images/settings_ad.png" width="48%" alt="Active Directory Sync settings" />
</p>

---

## ⛓️ System Architecture & Workflow Diagrams

### 1. Active Directory authentication via EAP-PEAP / MS-CHAPv2
This sequence diagram shows how a Wi-Fi client authenticates against Active Directory through FreeRADIUS and Samba Winbind.

```mermaid
sequenceDiagram
    autonumber
    actor User as Wi-Fi Client (Employee)
    participant AP as Access Point (NAS)
    participant FR as FreeRADIUS Server (Docker)
    participant WB as Samba Winbind (Host)
    participant DC as Active Directory DC (Windows Server)

    User->>AP: Connects using EAP-PEAP / MS-CHAPv2
    AP->>FR: RADIUS Access-Request (Tunnel Identity)
    Note over FR: Establish TLS Tunnel (EAP-PEAP)
    FR->>WB: Authenticate Outer/Inner identity via Winbind socket
    WB->>DC: NT Challenge-Response check (Netlogon)
    DC-->>WB: Challenge-Response Success
    WB-->>FR: Winbind Success
    Note over FR: Map AD User Groups -> RADIUS VLAN attributes
    FR-->>AP: RADIUS Access-Accept + VLAN ID (e.g. VLAN 250)
    AP-->>User: Connected (Dynamic IP in VLAN 250)
```

### 2. MAC Authentication Bypass (MAB) for IoT Devices
This flow shows how devices lacking EAP support (e.g. printers, IP cameras) get authenticated and mapped to their respective VLANs.

```mermaid
sequenceDiagram
    autonumber
    actor Device as IoT Device (Printer/IP Camera)
    participant AP as Switch / Access Point (NAS)
    participant FR as FreeRADIUS Server (Docker)
    participant DB as PostgreSQL Database

    Device->>AP: Connects to Network Port
    AP->>FR: RADIUS Access-Request (User-Name/Password = MAC Address)
    FR->>DB: Check MAC Address in 'radcheck' (6 normalized formats)
    DB-->>FR: Match found (Cleartext-Password match)
    FR->>DB: Fetch dynamic VLAN reply attributes from 'radreply'
    DB-->>FR: VLAN Profile (e.g., VLAN 252)
    FR-->>AP: RADIUS Access-Accept + VLAN ID (e.g. 252)
    AP-->>Device: Port Authorized (IP in VLAN 252)
```

### 3. Active Directory User and Group Synchronization
The background sync daemon regularly queries Active Directory and maintains local cache in PostgreSQL database to keep users and groups aligned.

```mermaid
flowchart TD
    subgraph Active Directory Domain
        AD[Active Directory Server]
    end

    subgraph FreeRADIUS Manager Server
        API[Node.js API Sync Scheduler]
        DB[(PostgreSQL Database)]
        FR[FreeRADIUS Server]
    end

    API -- Query LDAP (Every 1m) --> AD
    AD -- Return Users, Groups & Memberships --> API
    API -- Sync and Upsert User Profiles --> DB
    API -- Map AD Groups to radusergroup --> DB
    FR -- Query Users & ACL Profile Replies --> DB
```

---

## 🌟 Key Features

*   **Enterprise AD Sync**: Real-time background cron job to sync users, groups, and department mappings from Active Directory.
*   **MS-CHAPv2 & PEAP Support**: Secure 802.1X enterprise Wi-Fi authentication utilizing Samba Winbind integration.
*   **Dynamic VLAN Routing**: Predefined ACL profiles (VLAN, Cisco privilege level 15, Aruba User Role) assigned dynamically on successful login.
*   **Multi-Group AD Support**: Automated `Fall-Through := Yes` database reply attribute merging, enabling users in multiple AD groups to retrieve all their respective RADIUS attributes (e.g. Cisco shell privilege and Wi-Fi VLAN 250).
*   **MAC Authentication Bypass (MAB) / Device Registry**: Dedicated inventory page for IoT, printers, and cameras. Registers devices automatically in **6 compatibility formats** (raw, colon, and hyphen hex in both uppercase and lowercase) to guarantee out-of-the-box compatibility with any AP or switch vendor.
*   **AD-Integrated Web Admin Console**: Promote any synced AD or local user to Web Console Administrator. AD admins authenticate securely to the console using their actual AD domain passwords.
*   **Web Management Portal**: Fully responsive dashboard with real-time stats, Live Session controls (force disconnection), System Logs viewer with keyword filtering, and reporting utilities.

---

## 📋 Prerequisites & Requirements

Before deploying, ensure the host system has:
1.  **Docker & Docker Compose v2** installed.
2.  **Network Access** to the Active Directory Domain Controller (DC) (e.g., `192.168.22.225` on LDAP port `389` or LDAPS `636`).
3.  **Host Joined to Active Directory**: The host Ubuntu server must be joined to the AD domain with `winbindd` active so the docker container can delegate MS-CHAPv2 authentication to the host.

---

## 🏢 Step-by-Step Active Directory Host Join Guide

To support WPA2-Enterprise (PEAP/MS-CHAPv2) authentication, the host Ubuntu server must be joined to the domain. Run these commands on the **host machine**:

### 1. Install Domain Joining Packages
```bash
sudo apt update
sudo apt install -y realmd sssd sssd-tools samba-common-bin oddjob oddjob-mkhomedir packagekit winbind libpam-winbind libnss-winbind
```

### 2. Discover and Join the Domain
```bash
# Discover the AD Domain
realm discover YOURDOMAIN.LOCAL

# Join the domain using domain administrator credentials
sudo realm join -U Administrator YOURDOMAIN.LOCAL
```

### 3. Verify AD Winbind Connection
Ensure that the host winbind daemon is running and can talk to Active Directory:
```bash
sudo systemctl enable --now winbind

# Verify domain info
wbinfo -t
wbinfo -u
```

### 4. Locate the host `winbindd_priv` GID
FreeRADIUS runs inside Docker as the `freerad` user. To read the host's winbind socket `/run/samba/winbindd/winbindd_privileged`, the container GID must match the host's `winbindd_priv` GID:
```bash
getent group winbindd_priv
# Output example: winbindd_priv:x:986:
```
*   *Note: If the GID returned on your host is different than `986`, update the group GID inside the `freeradius/Dockerfile` (line `RUN groupmod -g 986 winbindd_priv`) to match your host GID.*

---

## 🚀 Quick Start & Installation

```bash
# 1. Clone and enter directory
git clone https://github.com/pirateszero92/free-redius.git
cd free-redius

# 2. Copy environment file template
cp .env.example .env

# 3. Edit .env (adjust production passwords, domain DC configurations, or secret keys)
nano .env

# 4. Build and start all services
sudo docker compose up -d --build
```
Wait ~30 seconds for the containers to fully start and run database migrations. The Web Portal is accessible at:
**`http://<your_server_ip>`** (Port 80)

*   **Default Credentials**: `admin` / `Admin@1234` (Go to **Settings → Change Password** immediately after logging in).

---

## 📦 Services

| Service | Port | Description |
|---|---|---|
| **nginx** | `80` (external) | Serves the static Web UI and reverse-proxies API requests. |
| **api** | `3000` (internal) | Node.js REST API providing backend routes and Active Directory Sync cron scheduler. |
| **freeradius** | `1812/udp`, `1813/udp` | RADIUS server for Authentication and Accounting requests. |
| **postgres** | `5432` (internal) | PostgreSQL Database storing user profiles, group profiles, device registry, and accounting records. |

---

## 📖 Web UI Configuration Guide

### 1. Configure AD Settings
*   Navigate to **Settings → Active Directory**.
*   Enter your Domain Host IP, Port, Base DN, Bind DN, and password.
*   Click **Test Connection** to confirm connectivity.
*   Once saved, scroll to the bottom, select the specific AD groups you wish to sync (e.g. `IT`, `MIS`), and click **Sync Now**.
*   The background sync cron job will run automatically every minute to sync membership changes from AD.

### 2. Configure Dynamic VLANs (ACL Profiles)
*   Navigate to **ACL Profiles** → click **+ Add Profile**.
*   Create a profile (e.g. `MIS VLAN 250`):
    *   **Vendor**: `unifi`
    *   **ACL Type**: `vlan`
    *   **Value**: `250`
*   Go to **Groups** → Edit the `MIS` group and select `MIS VLAN 250` as its ACL Profile.
*   All users in the `MIS` group will now be dynamically routed to VLAN 250 upon connecting to the SSID.

### 3. Register MAB Devices (IoT/Printers)
*   Go to **Devices** → click **+ Register Device**.
*   Enter the device MAC address (e.g. `C8:6E:08:5B:4A:23` or `c86e085b4a23`), name, and select a VLAN ACL Profile.
*   Once saved, the device will immediately bypass 802.1X authentication and get routed to its designated VLAN.

### 4. Add Web Administrators (Promote Users)
*   Go to **Settings → Admin Users** → click **+ Add Admin**.
*   To promote an existing AD user (like `arthit.n`), select them from the **Promote Existing User** dropdown.
*   Set their Authentication Source to **Active Directory (AD)**. The password field will be hidden.
*   Click **Create**. The user `arthit.n` can now log in to this console using their corporate AD password.

---

## 🛠️ Common Admin Commands

### Stream RADIUS Server Logs
```bash
docker compose logs -f freeradius
```

### Search System Logs from CLI
```bash
docker logs freeradius-server 2>&1 | grep -i "arthit.n"
```

### Simulate RADIUS Authentication (Test login from host)
```bash
docker exec -it freeradius-server radtest arthit.n 'YourPassword' 127.0.0.1 0 testing123
```

### Enter PostgreSQL Database Console
```bash
docker exec -it freeradius-postgres psql -U radius -d radius
```
