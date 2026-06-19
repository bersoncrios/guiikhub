import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DbService } from '../../core/db/db.service';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './auth.html',
  styleUrl: './auth.scss'
})
export class AuthComponent {
  public readonly db = inject(DbService);
  private readonly router = inject(Router);

  // Toggle between Login (true) and Register (false)
  isLoginMode = true;

  // Form Fields
  email = '';
  password = '';
  displayName = '';
  username = '';

  // Loading/submitting state
  readonly isSubmitting = signal(false);

  toggleMode() {
    this.isLoginMode = !this.isLoginMode;
  }

  async onSubmit() {
    if (this.isSubmitting()) return;

    if (!this.email || !this.password) {
      Swal.fire({
        icon: 'warning',
        title: 'Campos Vazios',
        text: 'Por favor, preencha o e-mail e a senha.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Preencher',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return;
    }

    this.isSubmitting.set(true);
    try {
      if (this.isLoginMode) {
        const success = await this.db.loginWithEmail(this.email, this.password);
        if (success) {
          this.router.navigate(['/admin']);
        }
      } else {
        if (!this.displayName || !this.username) {
          Swal.fire({
            icon: 'warning',
            title: 'Perfil Incompleto',
            text: 'Por favor, preencha o nome e o apelido.',
            background: '#121420',
            color: '#f1f5f9',
            confirmButtonText: 'Completar',
            customClass: {
              popup: 'guiik-swal-popup',
              title: 'guiik-swal-title',
              htmlContainer: 'guiik-swal-html',
              confirmButton: 'guiik-swal-confirm-btn'
            },
            buttonsStyling: false
          });
          this.isSubmitting.set(false);
          return;
        }
        const success = await this.db.signUpWithEmail(this.email, this.password, this.displayName, this.username);
        if (success) {
          this.router.navigate(['/admin']);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async loginWithGoogle() {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);
    try {
      const success = await this.db.loginWithGoogle();
      if (success) {
        this.router.navigate(['/admin']);
      }
    } catch (err) {
      console.error(err);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
