import { Injectable, inject } from '@angular/core';
import Swal from 'sweetalert2';
import { User, BlogSettings } from '../models/interfaces';
import { Firestore, doc, getDoc, setDoc, updateDoc } from '@angular/fire/firestore';
import { 
  Auth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  UserCredential 
} from '@angular/fire/auth';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  async loginWithGoogle(setCurrentUser: (u: User) => void): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const provider = new GoogleAuthProvider();
    try {
      const result: UserCredential = await signInWithPopup(this.auth, provider);
      const fbUser = result.user;
      
      const userRef = doc(this.firestore, `users/${fbUser.uid}`);
      const docSnap = await getDoc(userRef);
      
      if (!docSnap.exists()) {
        const defaultSettings: BlogSettings = {
          title: `${fbUser.displayName || 'Meu'}'s Space`,
          tagline: 'Toda paixão merece um espaço.',
          primaryColor: '#00f0ff',
          accentColor: '#ff007f',
          bgColor: '#08090d',
          cardBgColor: '#121420',
          textColor: '#f1f5f9',
          fontFamily: 'Space Grotesk',
          layoutType: 'grid',
          bannerUrl: '/images/cyberpunk_cover.png',
          sections: ['Geral', 'Tech', 'Quadrinhos']
        };
        
        const userProfile: User = {
          id: fbUser.uid,
          username: ((fbUser.displayName || 'user').replace(/[^a-zA-Z0-9]+/g, '') + fbUser.uid.substring(0, 4)).toLowerCase(),
          displayName: fbUser.displayName || 'Criador',
          avatarUrl: fbUser.photoURL || '/images/default-avatar.svg',
          bio: 'Novo criador no GuiikHub!',
          bannerUrl: '/images/cyberpunk_cover.png',
          blogSettings: defaultSettings,
          email: fbUser.email || undefined
        };

        await setDoc(userRef, userProfile);
        setCurrentUser(userProfile);
      } else {
        const existingData = docSnap.data() as User;
        if (!existingData.email && fbUser.email) {
          await updateDoc(userRef, { email: fbUser.email });
          existingData.email = fbUser.email;
        }
        setCurrentUser(existingData);
      }

      Swal.fire({
        icon: 'success',
        title: 'Conectado!',
        text: 'Você entrou com sucesso no GuiikHub!',
        timer: 1800,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html'
        }
      });
      return true;
    } catch (error) {
      console.error('Google Sign In Error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Falha na Conexão',
        text: 'Erro ao entrar com Google. Tente novamente.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'OK',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }
  }

  async signUpWithEmail(
    email: string, 
    pass: string, 
    displayName: string, 
    username: string, 
    usersList: User[],
    setCurrentUser: (u: User) => void
  ): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    try {
      const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]+/g, '');
      
      const usernameExists = usersList.some(u => u.username === cleanUsername);
      if (usernameExists) {
        Swal.fire({
          icon: 'error',
          title: 'Nome de Usuário Indisponível',
          text: 'Este apelido (username) já está sendo usado por outro criador.',
          background: '#121420',
          color: '#f1f5f9',
          confirmButtonText: 'Tentar Outro',
          customClass: {
            popup: 'guiik-swal-popup',
            title: 'guiik-swal-title',
            htmlContainer: 'guiik-swal-html',
            confirmButton: 'guiik-swal-confirm-btn'
          },
          buttonsStyling: false
        });
        return false;
      }

      const result: UserCredential = await createUserWithEmailAndPassword(this.auth, email, pass);
      const fbUser = result.user;
      
      const userRef = doc(this.firestore, `users/${fbUser.uid}`);
      
      const defaultSettings: BlogSettings = {
        title: `${displayName}'s Space`,
        tagline: 'Toda paixão merece um espaço.',
        primaryColor: '#8a2be2',
        accentColor: '#00f0ff',
        bgColor: '#0d0e15',
        cardBgColor: '#151724',
        textColor: '#f1f5f9',
        fontFamily: 'Outfit',
        layoutType: 'grid',
        bannerUrl: '/images/cyberpunk_cover.png',
        sections: ['Geral', 'Tech', 'Quadrinhos']
      };
      
      const userProfile: User = {
        id: fbUser.uid,
        username: cleanUsername,
        displayName: displayName,
        avatarUrl: '/images/default-avatar.svg',
        bio: 'Novo criador no GuiikHub!',
        bannerUrl: '/images/cyberpunk_cover.png',
        blogSettings: defaultSettings,
        email: email
      };

      await setDoc(userRef, userProfile);
      setCurrentUser(userProfile);
      
      Swal.fire({
        icon: 'success',
        title: 'Criado com Sucesso!',
        text: 'Sua conta GuiikHub foi criada e seu blog está pronto!',
        timer: 2000,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html'
        }
      });
      return true;
    } catch (error: any) {
      console.error('Email Sign Up Error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Erro no Cadastro',
        text: 'Não foi possível criar a conta: ' + (error.message || error),
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Voltar',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }
  }

  async loginWithEmail(email: string, pass: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    try {
      await signInWithEmailAndPassword(this.auth, email, pass);
      Swal.fire({
        icon: 'success',
        title: 'Entrou com Sucesso!',
        text: 'Bem-vindo de volta ao GuiikHub!',
        timer: 1800,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html'
        }
      });
      return true;
    } catch (error: any) {
      console.error('Email Login Error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Erro de Login',
        text: 'Não foi possível entrar: ' + (error.message || 'Verifique seus dados de acesso.'),
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Tentar Novamente',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }
  }

  async logout() {
    await signOut(this.auth);
    Swal.fire({
      icon: 'success',
      title: 'Sessão Encerrada',
      text: 'Desconectado com sucesso do GuiikHub!',
      timer: 1500,
      showConfirmButton: false,
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        htmlContainer: 'guiik-swal-html'
      }
    });
  }
}
