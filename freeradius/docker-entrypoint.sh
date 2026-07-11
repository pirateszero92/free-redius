#!/bin/bash
set -e

# Substitute environment variables in SQL module config
# Replace placeholders with actual env var values
SQL_CONF="/etc/freeradius/mods-available/sql"

sed -i "s|\${POSTGRES_HOST}|${POSTGRES_HOST:-postgres}|g" "$SQL_CONF"
sed -i "s|\${POSTGRES_USER}|${POSTGRES_USER:-radius}|g" "$SQL_CONF"
sed -i "s|\${POSTGRES_PASSWORD}|${POSTGRES_PASSWORD:-radius_secret}|g" "$SQL_CONF"
sed -i "s|\${POSTGRES_DB}|${POSTGRES_DB:-radius}|g" "$SQL_CONF"

echo "[entrypoint] FreeRADIUS SQL module configured:"
echo "  DB Host: ${POSTGRES_HOST:-postgres}"
echo "  DB Name: ${POSTGRES_DB:-radius}"
echo "  DB User: ${POSTGRES_USER:-radius}"

# Wait for postgres to be ready (up to 15 seconds)
echo "[entrypoint] Waiting for database connection..."
export PGPASSWORD="${POSTGRES_PASSWORD:-radius_secret}"
for i in {1..15}; do
    if pg_isready -h "${POSTGRES_HOST:-postgres}" -U "${POSTGRES_USER:-radius}" -d "${POSTGRES_DB:-radius}" > /dev/null 2>&1; then
        echo "[entrypoint] Database is ready!"
        break
    fi
    echo "[entrypoint] Database not ready yet, sleeping 1s..."
    sleep 1
done

# Query AD Settings
echo "[entrypoint] Querying Active Directory settings from Database..."
AD_SETTINGS=$(psql -h "${POSTGRES_HOST:-postgres}" -U "${POSTGRES_USER:-radius}" -d "${POSTGRES_DB:-radius}" -t -A -c "SELECT host || '|' || port || '|' || use_ssl || '|' || bind_dn || '|' || bind_password || '|' || base_dn FROM ad_settings LIMIT 1" 2>/dev/null)

if [ -n "$AD_SETTINGS" ]; then
    IFS='|' read -r AD_HOST AD_PORT AD_USE_SSL AD_BIND_DN AD_BIND_PASSWORD AD_BASE_DN <<< "$AD_SETTINGS"
fi

# Use defaults if empty
AD_HOST="${AD_HOST:-localhost}"
AD_PORT="${AD_PORT:-389}"
AD_USE_SSL="${AD_USE_SSL:-false}"
AD_BIND_DN="${AD_BIND_DN:-cn=admin,dc=example,dc=org}"
AD_BIND_PASSWORD="${AD_BIND_PASSWORD:-mypass}"
AD_BASE_DN="${AD_BASE_DN:-dc=example,dc=org}"

# Decide server URI
if [ "$AD_USE_SSL" = "true" ] || [ "$AD_USE_SSL" = "t" ]; then
    LDAP_SERVER="ldaps://${AD_HOST}"
else
    LDAP_SERVER="ldap://${AD_HOST}"
fi

echo "[entrypoint] Generating FreeRADIUS LDAP module configuration..."
echo "  LDAP Server: ${LDAP_SERVER}"
echo "  LDAP Port: ${AD_PORT}"
echo "  LDAP Bind DN: ${AD_BIND_DN}"
echo "  LDAP Base DN: ${AD_BASE_DN}"

# Generate ldap config file
cat <<EOF > /etc/freeradius/mods-available/ldap
# -*- text -*-
ldap {
	server = '${LDAP_SERVER}'
	port = ${AD_PORT}
	identity = '${AD_BIND_DN}'
	password = '${AD_BIND_PASSWORD}'
	base_dn = '${AD_BASE_DN}'

	user {
		base_dn = '${AD_BASE_DN}'
		filter = "(sAMAccountName=%{%{Stripped-User-Name}:-%{User-Name}})"
	}

	pool {
		start = 5
		min = 4
		max = 10
		spare = 3
		uses = 0
		lifetime = 0
		idle_timeout = 60
	}

	update {
		control:Password-With-Header	+= 'userPassword'
	}
}
EOF

# Symlink mods-enabled/ldap to enable it
ln -sf /etc/freeradius/mods-available/ldap /etc/freeradius/mods-enabled/ldap

exec "$@"
