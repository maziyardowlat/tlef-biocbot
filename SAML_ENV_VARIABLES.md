# SAML/UBC Shibboleth Environment Variables

This document lists all environment variables needed for SAML and UBC Shibboleth (CWL) authentication in BiocBot.

## UBC Shibboleth (CWL) Authentication

**Required for UBC Shibboleth to work:**

```env
# UBC Shibboleth Configuration (Required)
SAML_ISSUER=https://myapp.example.com/shibboleth
SAML_CALLBACK_URL=https://myapp.example.com/api/auth/ubcshib/callback

# Private Key Path (Required)
SAML_PRIVATE_KEY_PATH=/etc/app/saml/private.key
```

**Optional UBC Shibboleth Variables:**

```env
# Environment (STAGING or PRODUCTION) - defaults to STAGING
SAML_ENVIRONMENT=STAGING

# Custom SAML Attributes (comma-separated) - defaults to ['ubcEduCwlPuid', 'mail', 'eduPersonAffiliation']
SAML_ATTRIBUTES=ubcEduCwlPuid,mail,eduPersonAffiliation

# Single Logout (SLO) - defaults to true
ENABLE_SLO=true

# Validate InResponseTo - defaults to true
SAML_VALIDATE_IN_RESPONSE_TO=true

# Clock Skew (milliseconds) - defaults to 0
SAML_CLOCK_SKEW_MS=0

# UBC IdP Configuration (for reference, used by passport-ubcshib)
SAML_ENTRY_POINT=https://authentication.ubc.ca/idp/profile/SAML2/Redirect/SSO
SAML_LOGOUT_URL=https://authentication.ubc.ca/idp/profile/Logout
SAML_METADATA_URL=https://authentication.ubc.ca/idp/shibboleth
```

## Generic SAML Authentication

**Required for Generic SAML to work:**

```env
# Generic SAML Configuration (Required)
SAML_ENTRY_POINT=https://idp.example.com/sso/saml
SAML_ISSUER=your-issuer-identifier
SAML_CALLBACK_URL=https://your-domain.com/api/auth/saml/callback
SAML_CERT=-----BEGIN CERTIFICATE-----\n...your-certificate...\n-----END CERTIFICATE-----
```

**Optional Generic SAML Variables:**

```env
# Private Key (if signing requests) - optional
SAML_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...your-private-key...\n-----END PRIVATE KEY-----

# Signature Algorithm - defaults to sha256
SAML_SIGNATURE_ALGORITHM=sha256

# Digest Algorithm - defaults to sha256
SAML_DIGEST_ALGORITHM=sha256

# Clock Skew (milliseconds) - defaults to 0
SAML_CLOCK_SKEW_MS=0

# Validate InResponseTo - defaults to false (set to 'true' to enable)
SAML_VALIDATE_IN_RESPONSE_TO=false

# Disable Request ACS URL - defaults to false (set to 'true' to disable)
SAML_DISABLE_REQUEST_ACS_URL=false
```

## Summary: Minimum Required Variables

### For UBC Shibboleth (CWL) Only:
```env
SAML_ISSUER=https://myapp.example.com/shibboleth
SAML_CALLBACK_URL=https://myapp.example.com/api/auth/ubcshib/callback
SAML_PRIVATE_KEY_PATH=/etc/app/saml/private.key
```

### For Generic SAML Only:
```env
SAML_ENTRY_POINT=https://idp.example.com/sso/saml
SAML_ISSUER=your-issuer-identifier
SAML_CALLBACK_URL=https://your-domain.com/api/auth/saml/callback
SAML_CERT=-----BEGIN CERTIFICATE-----\n...certificate...\n-----END CERTIFICATE-----
```

## Example .env File Structure

```env
# ============================================
# UBC Shibboleth (CWL) Configuration
# ============================================
SAML_ENVIRONMENT=STAGING  # STAGING or PRODUCTION

# For custom IdP configuration
SAML_ENTRY_POINT=https://authentication.ubc.ca/idp/profile/SAML2/Redirect/SSO
SAML_LOGOUT_URL=https://authentication.ubc.ca/idp/profile/Logout
SAML_METADATA_URL=https://authentication.ubc.ca/idp/shibboleth

# Private key location
SAML_PRIVATE_KEY_PATH=/etc/app/saml/private.key

# Service Provider config
SAML_ISSUER=https://myapp.example.com/shibboleth
SAML_CALLBACK_URL=https://myapp.example.com/api/auth/ubcshib/callback

# Enable/disable features
ENABLE_SLO=true
SAML_VALIDATE_IN_RESPONSE_TO=true
SAML_CLOCK_SKEW_MS=0

# Custom attributes (optional)
SAML_ATTRIBUTES=ubcEduCwlPuid,mail,eduPersonAffiliation
```

## Notes

1. **Callback URLs**: Must match exactly what's configured in your SAML IdP (Identity Provider)
2. **Private Key**: Should be provided as a file path (`SAML_PRIVATE_KEY_PATH`)
3. **Environment**: Use `STAGING` for testing, `PRODUCTION` for live UBC Shibboleth
4. **UBC IdP URLs**: The `SAML_ENTRY_POINT`, `SAML_LOGOUT_URL`, and `SAML_METADATA_URL` are UBC-specific and typically don't need to be changed
5. **All variables use `SAML_` prefix**: No `UBC_SAML_` prefix is used - all variables use the generic `SAML_` naming convention

