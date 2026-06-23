import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';

const firebaseProdConfig = {
  apiKey: "AIzaSyBF8gXrQsqX4VmtVU23XjXCGC0iq7hknyQ",
  authDomain: "guiikhub-prod.firebaseapp.com",
  databaseURL: "https://guiikhub-prod-default-rtdb.firebaseio.com",
  projectId: "guiikhub-prod",
  storageBucket: "guiikhub-prod.firebasestorage.app",
  messagingSenderId: "260619295571",
  appId: "1:260619295571:web:5bbe673a942e8882cb9fa6",
  measurementId: "G-E6N73PDYSY"
};

const firebaseDevConfig = {
  apiKey: "AIzaSyBu_MIUzSSGZc8t7RwNMBeOamdi2RM5o54",
  authDomain: "brain-homol.firebaseapp.com",
  projectId: "brain-homol",
  storageBucket: "brain-homol.firebasestorage.app",
  messagingSenderId: "133819286687",
  appId: "1:133819286687:web:ce77393f9146e437524eaa",
  measurementId: "G-XG2GJ4L0KQ"
};

// Check if running on localhost / development environment
const isLocal = process.argv.includes('--local') || 
                process.argv.includes('--dev') || 
                process.env.NODE_ENV === 'development' || 
                process.env.USE_LOCAL === 'true';

const firebaseConfig = isLocal ? firebaseDevConfig : firebaseProdConfig;
console.log(`📡 Usando ambiente: ${isLocal ? 'DESENVOLVIMENTO (brain-homol)' : 'PRODUÇÃO (guiikhub-prod)'}`);


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function runMigration() {
  console.log('⚡ Iniciando migração de gamificação para usuários...');
  try {
    const usersCol = collection(db, 'users');
    const snapshot = await getDocs(usersCol);
    
    if (snapshot.empty) {
      console.log('Nenhum usuário encontrado para migrar.');
      return;
    }

    console.log(`Encontrados ${snapshot.size} usuários no Firestore. Analisando...`);
    const batch = writeBatch(db);
    let count = 0;

    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      const needsMigration = data.bits_balance === undefined || data.xp_points === undefined;

      if (needsMigration) {
        const userRef = doc(db, 'users', docSnap.id);
        const updates: any = {};
        if (data.bits_balance === undefined) updates.bits_balance = 0;
        if (data.xp_points === undefined) updates.xp_points = 0;
        
        batch.update(userRef, updates);
        count++;
        console.log(`- Usuário [ID: ${docSnap.id}] marcado para migração.`);
      }
    });

    if (count > 0) {
      await batch.commit();
      console.log(`🎉 Sucesso! Migração concluída. ${count} usuários foram atualizados.`);
    } else {
      console.log('✅ Todos os usuários já possuem os campos de gamificação inicializados. Nenhuma ação necessária.');
    }
  } catch (error) {
    console.error('❌ Erro durante a execução da migração:', error);
  }
}

runMigration().then(() => {
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
