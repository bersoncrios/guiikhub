import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

// Firebase imports
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getAnalytics, provideAnalytics } from '@angular/fire/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyBu_MIUzSSGZc8t7RwNMBeOamdi2RM5o54",
  authDomain: "brain-homol.firebaseapp.com",
  projectId: "brain-homol",
  storageBucket: "brain-homol.firebasestorage.app",
  messagingSenderId: "133819286687",
  appId: "1:133819286687:web:ce77393f9146e437524eaa",
  measurementId: "G-XG2GJ4L0KQ"
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    
    // Firebase Providers
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideFirestore(() => getFirestore()),
    provideAuth(() => getAuth()),
    provideAnalytics(() => {
      if (typeof window !== 'undefined') {
        return getAnalytics();
      }
      return null as any;
    })
  ]
};
