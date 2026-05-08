let ENV = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  TMDB_API_KEY: '',
  FIREBASE_API_KEY: '',
  FIREBASE_AUTH_DOMAIN: '',
  FIREBASE_PROJECT_ID: '',
  FIREBASE_STORAGE_BUCKET: '',
  FIREBASE_MESSAGING_SENDER_ID: '',
  FIREBASE_APP_ID: '',
  FIREBASE_MEASUREMENT_ID: ''
};

let envReady = false;

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const config = await response.json();
      ENV = {
        SUPABASE_URL: config.SUPABASE_URL || '',
        SUPABASE_ANON_KEY: config.SUPABASE_ANON_KEY || '',
        TMDB_API_KEY: config.TMDB_API_KEY || '',
        FIREBASE_API_KEY: config.FIREBASE_API_KEY || '',
        FIREBASE_AUTH_DOMAIN: config.FIREBASE_AUTH_DOMAIN || '',
        FIREBASE_PROJECT_ID: config.FIREBASE_PROJECT_ID || '',
        FIREBASE_STORAGE_BUCKET: config.FIREBASE_STORAGE_BUCKET || '',
        FIREBASE_MESSAGING_SENDER_ID: config.FIREBASE_MESSAGING_SENDER_ID || '',
        FIREBASE_APP_ID: config.FIREBASE_APP_ID || '',
        FIREBASE_MEASUREMENT_ID: config.FIREBASE_MEASUREMENT_ID || ''
      };
    }
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
