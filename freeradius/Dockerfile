FROM ubuntu:24.04

# Avoid prompt during installations
ENV DEBIAN_FRONTEND=noninteractive

# Install FreeRADIUS, LDAP, PostgreSQL, Winbind and build tools (matching host Ubuntu 24.04 versions!)
RUN apt-get update && apt-get install -y --no-install-recommends \
    freeradius \
    freeradius-postgresql \
    freeradius-ldap \
    freeradius-utils \
    postgresql-client \
    winbind \
    libpq-dev \
    make \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Modify existing winbindd_priv group GID to match host GID 986 and add freerad user
RUN groupmod -g 986 winbindd_priv || true && usermod -a -G winbindd_priv freerad || true

# Copy custom configuration files (Debian/Ubuntu packages put config in /etc/freeradius/3.0/)
COPY radiusd.conf /etc/freeradius/3.0/radiusd.conf
COPY clients.conf /etc/freeradius/3.0/clients.conf
COPY mods-available/sql /etc/freeradius/3.0/mods-available/sql
COPY mods-available/ldap /etc/freeradius/3.0/mods-available/ldap
COPY mods-available/mschap /etc/freeradius/3.0/mods-available/mschap
COPY sites-available/default /etc/freeradius/3.0/sites-available/default
COPY sites-available/inner-tunnel /etc/freeradius/3.0/sites-available/inner-tunnel

# Enable SQL and MSCHAP modules (create symlinks)
RUN ln -sf /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql \
    && ln -sf /etc/freeradius/3.0/mods-available/mschap /etc/freeradius/3.0/mods-enabled/mschap

# Generate default self-signed certificates if they don't exist
RUN make -C /etc/freeradius/3.0/certs || true

# Copy entrypoint script that substitutes env vars
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 1812/udp 1813/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeradius", "-f", "-l", "stdout"]
