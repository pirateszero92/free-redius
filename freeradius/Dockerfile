FROM freeradius/freeradius-server:latest

# Install PostgreSQL client library for rlm_sql_postgresql
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    freeradius-postgresql \
    && rm -rf /var/lib/apt/lists/*

# Copy custom configuration files
COPY radiusd.conf /etc/freeradius/radiusd.conf
COPY clients.conf /etc/freeradius/clients.conf
COPY mods-available/sql /etc/freeradius/mods-available/sql
COPY sites-available/default /etc/freeradius/sites-available/default
COPY sites-available/inner-tunnel /etc/freeradius/sites-available/inner-tunnel

# Enable SQL module (create symlink)
RUN ln -sf /etc/freeradius/mods-available/sql /etc/freeradius/mods-enabled/sql

# Copy entrypoint script that substitutes env vars
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 1812/udp 1813/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeradius", "-f", "-l", "stdout"]
