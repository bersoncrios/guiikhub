import { Injectable, inject } from '@angular/core';
// import { Firestore, collection, doc, setDoc, addDoc, getDocs, updateDoc, deleteDoc, query, where, orderBy } from '@angular/fire/firestore';
// import { Auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from '@angular/fire/auth';

/**
 * ==========================================================================
 * GUIA DE INTEGRAÇÃO FIREBASE (PASSO A PASSO)
 * ==========================================================================
 * 
 * 1. Instalar as dependências adicionadas no package.json:
 *    Run: npm install
 * 
 * 2. Habilitar o Firebase em src/app/app.config.ts:
 *    Importar e adicionar os providers no array de `providers`:
 * 
 *    import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
 *    import { getFirestore, provideFirestore } from '@angular/fire/firestore';
 *    import { getAuth, provideAuth } from '@angular/fire/auth';
 * 
 *    const firebaseConfig = {
 *      apiKey: "SUA_API_KEY",
 *      authDomain: "seu-projeto.firebaseapp.com",
 *      projectId: "seu-projeto",
 *      storageBucket: "seu-projeto.appspot.com",
 *      messagingSenderId: "SEU_SENDER_ID",
 *      appId: "SEU_APP_ID"
 *    };
 * 
 *    Adicionar aos providers:
 *    [
 *      ...
 *      provideFirebaseApp(() => initializeApp(firebaseConfig)),
 *      provideFirestore(() => getFirestore()),
 *      provideAuth(() => getAuth())
 *    ]
 * 
 * 3. Habilitar serviços no console do Firebase:
 *    - Firestore Database (em modo teste ou produção com regras corretas).
 *    - Authentication (habilitar o método Email/Senha).
 * 
 * 4. Descomentar os códigos abaixo e fazer a ponte com o DbService.
 */

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  // private firestore = inject(Firestore);
  // private auth = inject(Auth);

  constructor() {}

  /*
  // Exemplo: Buscar matérias do Firestore
  async getArticles() {
    const articlesCol = collection(this.firestore, 'articles');
    const q = query(articlesCol, orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  // Exemplo: Salvar matéria no Firestore
  async addArticle(title: string, summary: string, content: string, coverUrl: string, tags: string[], author: any) {
    const articlesCol = collection(this.firestore, 'articles');
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    
    const docRef = await addDoc(articlesCol, {
      title,
      slug,
      summary,
      content,
      coverUrl,
      authorId: author.id,
      authorUsername: author.username,
      authorDisplayName: author.displayName,
      authorAvatarUrl: author.avatarUrl,
      createdAt: new Date().toISOString(),
      tags,
      likesCount: 0,
      commentsCount: 0
    });
    
    return docRef.id;
  }

  // Exemplo: Curtir matéria
  async toggleLike(articleId: string, userId: string, isCurrentlyLiked: boolean) {
    const articleDoc = doc(this.firestore, `articles/${articleId}`);
    const likeDoc = doc(this.firestore, `likes/${userId}_${articleId}`);

    if (isCurrentlyLiked) {
      // Remover Curtida
      await deleteDoc(likeDoc);
      // Decrementar no artigo (idealmente com increment(-1) do firestore fieldvalue)
    } else {
      // Adicionar Curtida
      await setDoc(likeDoc, { userId, articleId, createdAt: new Date().toISOString() });
      // Incrementar no artigo
    }
  }

  // Exemplo: Cadastrar Usuário
  async registerUser(email: string, pass: string, username: string, displayName: string) {
    // 1. Criar no Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(this.auth, email, pass);
    const firebaseUser = userCredential.user;

    // 2. Salvar dados adicionais no Firestore
    const userDoc = doc(this.firestore, `users/${firebaseUser.uid}`);
    const userData = {
      id: firebaseUser.uid,
      username: username.toLowerCase().replace(/[^a-z0-9]+/g, ''),
      displayName,
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
      bio: 'Novo criador no GuiikHub!',
      blogSettings: {
        title: `${displayName}'s Space`,
        tagline: 'Bem-vindo ao meu blog personalizável.',
        primaryColor: '#8a2be2',
        accentColor: '#00f0ff',
        bgColor: '#0d0e15',
        cardBgColor: '#151724',
        textColor: '#f1f5f9',
        fontFamily: 'Outfit',
        layoutType: 'grid',
        bannerUrl: '/images/cyberpunk_cover.png'
      }
    };

    await setDoc(userDoc, userData);
    return userData;
  }
  */
}
