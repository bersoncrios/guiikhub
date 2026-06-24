const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');

// Read and parse .env manually (no dependencies)
function loadEnv() {
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const firstEquals = trimmed.indexOf('=');
        if (firstEquals !== -1) {
          const key = trimmed.substring(0, firstEquals).trim();
          const value = trimmed.substring(firstEquals + 1).trim().replace(/^['"]|['"]$/g, '');
          if (key) {
            env[key] = value;
          }
        }
      }
    });
  }
  return env;
}

const env = loadEnv();

// environment.ts (Production)
const prodEnvContent = `export const environment = {
  production: true,
  firebase: {
    apiKey: "${env.FIREBASE_PROD_API_KEY || ''}",
    authDomain: "${env.FIREBASE_PROD_AUTH_DOMAIN || ''}",
    databaseURL: "${env.FIREBASE_PROD_DATABASE_URL || ''}",
    projectId: "${env.FIREBASE_PROD_PROJECT_ID || ''}",
    storageBucket: "${env.FIREBASE_PROD_STORAGE_BUCKET || ''}",
    messagingSenderId: "${env.FIREBASE_PROD_MESSAGING_SENDER_ID || ''}",
    appId: "${env.FIREBASE_PROD_APP_ID || ''}",
    measurementId: "${env.FIREBASE_PROD_MEASUREMENT_ID || ''}"
  },
  tebi: {
    accessKeyId: "${env.TEBI_ACCESS_KEY_ID || ''}",
    secretAccessKey: "${env.TEBI_SECRET_ACCESS_KEY || ''}"
  },
  emailjs: {
    serviceId: "${env.EMAILJS_SERVICE_ID || ''}",
    templateId: "${env.EMAILJS_TEMPLATE_ID || ''}",
    publicKey: "${env.EMAILJS_PUBLIC_KEY || ''}",
    privateKey: "${env.EMAILJS_PRIVATE_KEY || ''}"
  }
};
`;

// environment.development.ts (Development)
const devEnvContent = `export const environment = {
  production: false,
  firebase: {
    apiKey: "${env.FIREBASE_DEV_API_KEY || ''}",
    authDomain: "${env.FIREBASE_DEV_AUTH_DOMAIN || ''}",
    projectId: "${env.FIREBASE_DEV_PROJECT_ID || ''}",
    storageBucket: "${env.FIREBASE_DEV_STORAGE_BUCKET || ''}",
    messagingSenderId: "${env.FIREBASE_DEV_MESSAGING_SENDER_ID || ''}",
    appId: "${env.FIREBASE_DEV_APP_ID || ''}",
    measurementId: "${env.FIREBASE_DEV_MEASUREMENT_ID || ''}"
  },
  tebi: {
    accessKeyId: "${env.TEBI_ACCESS_KEY_ID || ''}",
    secretAccessKey: "${env.TEBI_SECRET_ACCESS_KEY || ''}"
  },
  emailjs: {
    serviceId: "${env.EMAILJS_SERVICE_ID || ''}",
    templateId: "${env.EMAILJS_TEMPLATE_ID || ''}",
    publicKey: "${env.EMAILJS_PUBLIC_KEY || ''}",
    privateKey: "${env.EMAILJS_PRIVATE_KEY || ''}"
  }
};
`;

const environmentsDir = path.join(__dirname, '../src/environments');

if (!fs.existsSync(environmentsDir)) {
  fs.mkdirSync(environmentsDir, { recursive: true });
}

fs.writeFileSync(path.join(environmentsDir, 'environment.ts'), prodEnvContent, 'utf8');
fs.writeFileSync(path.join(environmentsDir, 'environment.development.ts'), devEnvContent, 'utf8');

console.log('[Angular Environment] Generated environment.ts and environment.development.ts from .env');
process.exit(0);
