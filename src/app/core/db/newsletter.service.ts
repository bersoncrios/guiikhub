import { Injectable, inject } from '@angular/core';
import Swal from 'sweetalert2';
import { User, Article } from '../models/interfaces';
import { Firestore, doc, getDoc, updateDoc, setDoc } from '@angular/fire/firestore';

import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class NewsletterService {
  private readonly firestore = inject(Firestore);

  private readonly emailjsServiceId = environment.emailjs.serviceId;
  private readonly emailjsTemplateId = environment.emailjs.templateId;
  private readonly emailjsPublicKey = environment.emailjs.publicKey;

  async sendNewsletter(
    articleId: string, 
    blogId: string, 
    followsList: Array<{ followerId: string; followedId: string }>, 
    usersList: User[]
  ) {
    const artSnap = await getDoc(doc(this.firestore, `articles/${articleId}`));
    if (!artSnap.exists()) return;
    const art = artSnap.data() as Article;

    const followers = followsList
      .filter(f => f.followedId === blogId)
      .map(f => f.followerId);

    const recipientUsers = usersList.filter(u => followers.includes(u.id));
    const blogOwner = usersList.find(u => u.id === blogId);
    const blogTitle = blogOwner?.blogSettings?.title || blogOwner?.displayName || 'Blog';

    Swal.fire({
      title: 'Disparando Newsletter...',
      text: `Enviando e-mails para ${recipientUsers.length} seguidores via EmailJS...`,
      allowOutsideClick: false,
      background: '#121420',
      color: '#f1f5f9',
      didOpen: () => {
        Swal.showLoading();
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    let sentCount = 0;
    for (const recUser of recipientUsers) {
      if (recUser.email) {
        const emailHtml = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0d0e15; color: #f1f5f9; padding: 2rem; border-radius: 16px; border: 1px solid #1f2937;">
            <div style="text-align: center; margin-bottom: 2rem; border-bottom: 1px solid #1f2937; padding-bottom: 1.5rem;">
              <h1 style="color: #00f0ff; margin: 0; font-size: 1.8rem; letter-spacing: 1px;">${blogTitle}</h1>
              <p style="color: #94a3b8; margin: 0.5rem 0 0; font-size: 0.9rem;">Newsletter do GuiikHub</p>
            </div>
            
            <div style="margin-bottom: 2rem;">
              <img src="${art.coverUrl}" alt="Capa" style="width: 100%; border-radius: 12px; margin-bottom: 1.5rem; border: 1px solid #374151;">
              <h2 style="color: #ffffff; font-size: 1.5rem; line-height: 1.3; margin: 0 0 1rem 0;">${art.title}</h2>
              <p style="color: #cbd5e1; font-size: 1rem; line-height: 1.6; margin: 0 0 1.5rem 0;">${art.summary}</p>
              
              <div style="text-align: center; margin: 2rem 0;">
                <a href="https://guiikhub.com/b/${art.authorUsername}/post/${art.slug}" style="background-color: #00f0ff; color: #0d0e15; padding: 0.8rem 2rem; border-radius: 9999px; text-decoration: none; font-weight: bold; font-size: 1rem; box-shadow: 0 0 15px rgba(0, 240, 255, 0.4); display: inline-block;">
                  ⚡ Ler Matéria Completa
                </a>
              </div>
            </div>
            
            <div style="border-top: 1px solid #1f2937; padding-top: 1.5rem; text-align: center; font-size: 0.8rem; color: #6b7280; display: flex; align-items: center; justify-content: center; gap: 0.75rem;">
              <img src="${art.authorAvatarUrl}" alt="${art.authorDisplayName}" style="width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid #00f0ff; object-fit: cover;">
              <div>
                Publicado por <strong>${art.authorDisplayName}</strong><br>
                Você está recebendo este e-mail porque segue o blog no GuiikHub.
              </div>
            </div>
          </div>
        `;

        try {
          const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              service_id: this.emailjsServiceId,
              template_id: this.emailjsTemplateId,
              user_id: this.emailjsPublicKey,
              template_params: {
                to_email: recUser.email,
                to_name: recUser.displayName || recUser.username,
                blog_title: blogTitle,
                article_title: art.title,
                article_summary: art.summary,
                article_link: `https://guiikhub.com/b/${art.authorUsername}/post/${art.slug}`,
                author_name: art.authorDisplayName,
                message_html: emailHtml
              }
            })
          });

          if (response.ok) {
            sentCount++;
          } else {
            console.error('EmailJS dispatch failed for user:', recUser.email, await response.text());
          }
        } catch (err) {
          console.error('Error calling EmailJS API for user:', recUser.email, err);
        }
      }
    }

    const sendId = 'ns_' + Date.now();
    const log = {
      id: sendId,
      articleId,
      blogId,
      sentAt: new Date().toISOString(),
      recipientsCount: sentCount,
      recipientUsernames: recipientUsers.filter(u => u.email).map(u => u.username)
    };

    await setDoc(doc(this.firestore, `newsletter_sends/${sendId}`), log);

    await updateDoc(doc(this.firestore, `articles/${articleId}`), {
      newsletterSent: true
    });

    Swal.close();

    Swal.fire({
      icon: 'success',
      title: 'Newsletter Disparada!',
      text: `Foram enviados ${sentCount} e-mails via EmailJS com sucesso para seus seguidores!`,
      background: '#121420',
      color: '#f1f5f9',
      confirmButtonText: 'Sensacional!',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        htmlContainer: 'guiik-swal-html',
        confirmButton: 'guiik-swal-confirm-btn'
      },
      buttonsStyling: false
    });
  }
}
