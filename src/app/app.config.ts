import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

// Firebase imports
import { getApps, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, provideFirestore } from '@angular/fire/firestore';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getAnalytics, provideAnalytics } from '@angular/fire/analytics';

// Environment configurations
import { environment } from '../environments/environment';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    
    // Firebase Providers
    provideFirebaseApp(() => {
      const apps = getApps();
      if (apps.length > 0) {
        return apps[0];
      }
      return initializeApp(environment.firebase);
    }),
    provideFirestore(() => {
      const apps = getApps();
      if (typeof window === 'undefined') {
        return getFirestore(apps[0]);
      }
      try {
        return initializeFirestore(apps[0], {
          localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        });
      } catch (e) {
        return getFirestore(apps[0]);
      }
    }),
    provideAuth(() => getAuth()),
    provideAnalytics(() => {
      if (typeof window !== 'undefined' && (environment.firebase as any).measurementId) {
        return getAnalytics();
      }
      return null as any;
    }), provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000'
          })
  ]
};
