-- ============================================================
-- FreeRADIUS PostgreSQL Schema + Custom App Tables
-- ============================================================

-- -------------------------------------------------------
-- FreeRADIUS Standard Tables
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS radcheck (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(64) NOT NULL DEFAULT '',
    attribute   VARCHAR(64) NOT NULL DEFAULT '',
    op          CHAR(2) NOT NULL DEFAULT '==',
    value       VARCHAR(253) NOT NULL DEFAULT '',
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS radcheck_username ON radcheck (username, attribute);

CREATE TABLE IF NOT EXISTS radreply (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(64) NOT NULL DEFAULT '',
    attribute   VARCHAR(64) NOT NULL DEFAULT '',
    op          CHAR(2) NOT NULL DEFAULT '=',
    value       VARCHAR(253) NOT NULL DEFAULT '',
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS radreply_username ON radreply (username, attribute);

CREATE TABLE IF NOT EXISTS radgroupcheck (
    id          SERIAL PRIMARY KEY,
    groupname   VARCHAR(64) NOT NULL DEFAULT '',
    attribute   VARCHAR(64) NOT NULL DEFAULT '',
    op          CHAR(2) NOT NULL DEFAULT '==',
    value       VARCHAR(253) NOT NULL DEFAULT '',
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS radgroupcheck_groupname ON radgroupcheck (groupname, attribute);

CREATE TABLE IF NOT EXISTS radgroupreply (
    id          SERIAL PRIMARY KEY,
    groupname   VARCHAR(64) NOT NULL DEFAULT '',
    attribute   VARCHAR(64) NOT NULL DEFAULT '',
    op          CHAR(2) NOT NULL DEFAULT '=',
    value       VARCHAR(253) NOT NULL DEFAULT '',
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS radgroupreply_groupname ON radgroupreply (groupname, attribute);

CREATE TABLE IF NOT EXISTS radusergroup (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(64) NOT NULL DEFAULT '',
    groupname   VARCHAR(64) NOT NULL DEFAULT '',
    priority    INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS radusergroup_username ON radusergroup (username);
CREATE UNIQUE INDEX IF NOT EXISTS radusergroup_unique ON radusergroup (username, groupname);

CREATE TABLE IF NOT EXISTS nas (
    id          SERIAL PRIMARY KEY,
    nasname     VARCHAR(128) NOT NULL,
    shortname   VARCHAR(32),
    type        VARCHAR(30) DEFAULT 'other',
    ports       INTEGER,
    secret      VARCHAR(60) NOT NULL DEFAULT 'secret',
    server      VARCHAR(64),
    community   VARCHAR(50),
    description VARCHAR(200) DEFAULT 'RADIUS Client',
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nas_nasname ON nas (nasname);

CREATE TABLE IF NOT EXISTS radacct (
    radacctid           BIGSERIAL PRIMARY KEY,
    acctsessionid       VARCHAR(64) NOT NULL DEFAULT '',
    acctuniqueid        VARCHAR(32) NOT NULL DEFAULT '',
    username            VARCHAR(64) NOT NULL DEFAULT '',
    realm               VARCHAR(64) DEFAULT '',
    nasipaddress        INET NOT NULL,
    nasportid           VARCHAR(15),
    nasporttype         VARCHAR(32),
    acctstarttime       TIMESTAMP WITH TIME ZONE,
    acctupdatetime      TIMESTAMP WITH TIME ZONE,
    acctstoptime        TIMESTAMP WITH TIME ZONE,
    acctinterval        INTEGER,
    acctsessiontime     INTEGER,
    acctauthentic       VARCHAR(32),
    connectinfo_start   VARCHAR(50),
    connectinfo_stop    VARCHAR(50),
    acctinputoctets     BIGINT,
    acctoutputoctets    BIGINT,
    calledstationid     VARCHAR(50),
    callingstationid    VARCHAR(50),
    acctterminatecause  VARCHAR(32),
    servicetype         VARCHAR(32),
    framedprotocol      VARCHAR(32),
    framedipaddress     INET,
    framedipv6address   INET,
    framedipv6prefix    INET,
    framedinterfaceid   VARCHAR(44),
    delegatedipv6prefix INET
);
CREATE UNIQUE INDEX IF NOT EXISTS radacct_acctuniqueid ON radacct (acctuniqueid);
CREATE INDEX IF NOT EXISTS radacct_username ON radacct (username);
CREATE INDEX IF NOT EXISTS radacct_acctsessionid ON radacct (acctsessionid);
CREATE INDEX IF NOT EXISTS radacct_acctstarttime ON radacct (acctstarttime);
CREATE INDEX IF NOT EXISTS radacct_acctstoptime ON radacct (acctstoptime);
CREATE INDEX IF NOT EXISTS radacct_nasipaddress ON radacct (nasipaddress);

CREATE TABLE IF NOT EXISTS radpostauth (
    id          BIGSERIAL PRIMARY KEY,
    username    VARCHAR(64) NOT NULL DEFAULT '',
    pass        VARCHAR(64) NOT NULL DEFAULT '',
    reply       VARCHAR(32) NOT NULL DEFAULT '',
    calledstationid VARCHAR(50),
    callingstationid VARCHAR(50),
    authdate    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS radpostauth_username ON radpostauth (username);
CREATE INDEX IF NOT EXISTS radpostauth_authdate ON radpostauth (authdate);

-- -------------------------------------------------------
-- Custom Application Tables
-- -------------------------------------------------------

-- Admin users for web GUI
CREATE TABLE IF NOT EXISTS admin_users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(64) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    full_name   VARCHAR(128),
    email       VARCHAR(128),
    role        VARCHAR(20) NOT NULL DEFAULT 'admin',
    source      VARCHAR(20) NOT NULL DEFAULT 'local',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    last_login  TIMESTAMP,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- Active Directory / LDAP Settings
CREATE TABLE IF NOT EXISTS ad_settings (
    id              SERIAL PRIMARY KEY,
    host            VARCHAR(255) NOT NULL DEFAULT '',
    port            INTEGER NOT NULL DEFAULT 389,
    use_ssl         BOOLEAN NOT NULL DEFAULT FALSE,
    use_tls         BOOLEAN NOT NULL DEFAULT FALSE,
    bind_dn         VARCHAR(512) NOT NULL DEFAULT '',
    bind_password   VARCHAR(255) NOT NULL DEFAULT '',
    base_dn         VARCHAR(512) NOT NULL DEFAULT '',
    user_filter     VARCHAR(512) NOT NULL DEFAULT '(objectClass=person)',
    group_filter    VARCHAR(512) NOT NULL DEFAULT '(objectClass=group)',
    user_attr       VARCHAR(64) NOT NULL DEFAULT 'sAMAccountName',
    email_attr      VARCHAR(64) NOT NULL DEFAULT 'mail',
    display_name_attr VARCHAR(64) NOT NULL DEFAULT 'displayName',
    group_member_attr VARCHAR(64) NOT NULL DEFAULT 'member',
    is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    last_sync       TIMESTAMP,
    sync_interval   INTEGER NOT NULL DEFAULT 60,
    selected_groups TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- App general settings
CREATE TABLE IF NOT EXISTS app_settings (
    id      SERIAL PRIMARY KEY,
    key     VARCHAR(128) NOT NULL UNIQUE,
    value   TEXT,
    description VARCHAR(255),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Users extended info (linked to radcheck username)
CREATE TABLE IF NOT EXISTS user_profiles (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(64) NOT NULL UNIQUE,
    full_name   VARCHAR(128),
    email       VARCHAR(128),
    phone       VARCHAR(32),
    department  VARCHAR(128),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    source      VARCHAR(20) NOT NULL DEFAULT 'local',
    ad_dn       VARCHAR(512),
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- AD Groups extended info
CREATE TABLE IF NOT EXISTS group_profiles (
    id          SERIAL PRIMARY KEY,
    groupname   VARCHAR(64) NOT NULL UNIQUE,
    description VARCHAR(255),
    source      VARCHAR(20) NOT NULL DEFAULT 'local',
    ad_dn       VARCHAR(512),
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- -------------------------------------------------------
-- Seed Data
-- -------------------------------------------------------

-- Default AD settings row (singleton)
INSERT INTO ad_settings (id, host, port, use_ssl, bind_dn, bind_password, base_dn, is_enabled)
VALUES (1, '', 389, false, '', '', '', false)
ON CONFLICT (id) DO NOTHING;

-- Default app settings
INSERT INTO app_settings (key, value, description) VALUES
  ('site_name', 'FreeRADIUS Manager', 'Application display name'),
  ('session_timeout', '28800', 'RADIUS session timeout in seconds'),
  ('max_sessions_per_user', '1', 'Max concurrent sessions per user')
ON CONFLICT (key) DO NOTHING;

-- Default admin user is created by the API on first startup
-- using the ADMIN_USERNAME and ADMIN_PASSWORD environment variables
-- Default: admin / Admin@1234


-- -------------------------------------------------------
-- ACL Profiles
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS acl_profiles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL UNIQUE,
    description VARCHAR(255),
    vendor VARCHAR(64) NOT NULL, -- standard, cisco, aruba, ubiquiti
    acl_type VARCHAR(64) NOT NULL, -- vlan, privilege, role, filter_id, custom
    value VARCHAR(255) NOT NULL, -- e.g. VLAN ID, Role Name, Privilege Level
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS acl_profile_id INTEGER REFERENCES acl_profiles(id) ON DELETE SET NULL;
ALTER TABLE group_profiles ADD COLUMN IF NOT EXISTS acl_profile_id INTEGER REFERENCES acl_profiles(id) ON DELETE SET NULL;

-- Seed some default ACL profiles
INSERT INTO acl_profiles (name, description, vendor, acl_type, value) VALUES
  ('VLAN 10 - Staff', 'Assigns user/group to VLAN 10', 'standard', 'vlan', '10'),
  ('VLAN 20 - Guest', 'Assigns user/group to VLAN 20', 'standard', 'vlan', '20'),
  ('Cisco Privilege 15', 'Full admin privilege level 15 on Cisco devices', 'cisco', 'privilege', '15'),
  ('Aruba Admin Role', 'Assigns Employee-Role on Aruba network', 'aruba', 'role', 'Employee-Role')
ON CONFLICT (name) DO NOTHING;

-- -------------------------------------------------------
-- Guest Captive Portal Tables
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS guest_users (
    id            SERIAL PRIMARY KEY,
    mac_address   VARCHAR(20) NOT NULL,
    provider      VARCHAR(50) NOT NULL, -- 'google', 'github', 'apple', 'line', 'local'
    social_id     VARCHAR(255) NOT NULL,
    email         VARCHAR(255),
    name          VARCHAR(255),
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guest_sessions (
    id            SERIAL PRIMARY KEY,
    mac_address   VARCHAR(20) NOT NULL,
    ap_mac        VARCHAR(20),
    ssid          VARCHAR(128),
    authorized_at TIMESTAMP DEFAULT NOW(),
    expires_at    TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_settings (
    id                   SERIAL PRIMARY KEY,
    unifi_url            VARCHAR(255),
    unifi_username       VARCHAR(128),
    unifi_password       VARCHAR(255),
    unifi_site           VARCHAR(128) DEFAULT 'default',
    unifi_verify_ssl     BOOLEAN DEFAULT FALSE,
    session_duration_mins INTEGER DEFAULT 120,
    google_client_id     VARCHAR(255),
    google_client_secret VARCHAR(255),
    google_enabled       BOOLEAN DEFAULT FALSE,
    github_client_id     VARCHAR(255),
    github_client_secret VARCHAR(255),
    github_enabled       BOOLEAN DEFAULT FALSE,
    line_client_id       VARCHAR(255),
    line_client_secret   VARCHAR(255),
    line_enabled         BOOLEAN DEFAULT FALSE,
    created_at           TIMESTAMP DEFAULT NOW(),
    updated_at           TIMESTAMP DEFAULT NOW()
);

INSERT INTO guest_settings (id, unifi_site, unifi_verify_ssl, session_duration_mins, google_enabled, github_enabled, line_enabled)
VALUES (1, 'default', FALSE, 120, FALSE, FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;


