import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hhs.taibu',
  appName: '太卜',
  webDir: 'capacitor-www',
  server: {
    url: 'https://www.mingai.fun',
    cleartext: false,
    allowNavigation: [
      'mingai.fun',
      '*.mingai.fun',
    ],
  },
  ios: {
    contentInset: 'always',
  },
};

export default config;
