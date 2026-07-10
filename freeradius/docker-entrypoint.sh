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

exec "$@"
