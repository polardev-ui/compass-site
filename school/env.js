let ENV = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  TMDB_API_KEY: '',
  SPOTIFY_CLIENT_ID: '',
  FIREBASE_API_KEY: '',
  FIREBASE_AUTH_DOMAIN: '',
  FIREBASE_PROJECT_ID: '',
  FIREBASE_STORAGE_BUCKET: '',
  FIREBASE_MESSAGING_SENDER_ID: '',
  FIREBASE_APP_ID: '',
  FIREBASE_MEASUREMENT_ID: ''
};

let envReady = false;

function applyConfig(config) {
  ENV = {
    SUPABASE_URL: config.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: config.SUPABASE_ANON_KEY || '',
    TMDB_API_KEY: config.TMDB_API_KEY || '',
    SPOTIFY_CLIENT_ID: config.SPOTIFY_CLIENT_ID || '',
    FIREBASE_API_KEY: config.FIREBASE_API_KEY || '',
    FIREBASE_AUTH_DOMAIN: config.FIREBASE_AUTH_DOMAIN || '',
    FIREBASE_PROJECT_ID: config.FIREBASE_PROJECT_ID || '',
    FIREBASE_STORAGE_BUCKET: config.FIREBASE_STORAGE_BUCKET || '',
    FIREBASE_MESSAGING_SENDER_ID: config.FIREBASE_MESSAGING_SENDER_ID || '',
    FIREBASE_APP_ID: config.FIREBASE_APP_ID || '',
    FIREBASE_MEASUREMENT_ID: config.FIREBASE_MEASUREMENT_ID || ''
  };
}

async function loadConfig() {
  if (window.__env) {
    applyConfig(window.__env);
    envReady = true;
    return;
  }

  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      applyConfig(await response.json());
      envReady = true;
      return;
    }
  } catch (error) {
  }

  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/config.local.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    if (window.__env) applyConfig(window.__env);
  } catch (error) {
  }

  envReady = true;
}

loadConfig();

async function waitForConfig(timeout = 5000) {
  const start = Date.now();
  while (!envReady && Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 50));
  }
}
