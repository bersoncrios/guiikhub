# ⚡ GuiikHub

GuiikHub é uma plataforma moderna de publicação de artigos e blogs para a comunidade geek/tech. Ela traz recursos avançados de gamificação, leilão de holofote, envio de newsletters e colaboração entre criadores, desenvolvida com as melhores práticas e alta performance.

---

## 🚀 Funcionalidades Principais

* **⚡ Sistema de Gamificação (XP & Bits)**:
  * Ganho de **XP** e **Bits** (moeda interna) ao interagir com a plataforma (leitura, curtidas, comentários, aplausos).
  * Conquista e desbloqueio de **Medalhas (Badges)** baseadas nos seus pontos acumulados.
* **🎯 Leilão de Holofote (Spotlight)**:
  * Um leilão diário onde criadores dão lances usando seus Bits acumulados para destacar seus artigos na página principal do feed.
  * Consolidação automática diária.
* **👥 Colaboração & Autoria**:
  * Adicione colaboradores para editar seus artigos em conjunto.
  * Controle de versões salvas (`ArticleVersion`) e notas internas (`ArticleNote`) do editor.
* **📨 Newsletter Integrada**:
  * Disparo automático de e-mails formatados via **EmailJS** para todos os seguidores de um blog assim que um artigo é publicado.
* **📂 Upload de Mídia Otimizado**:
  * Upload de imagens de capa de artigos direto para o armazenamento descentralizado e redundante da **Tebi Storage** (S3-compatible).
* **📱 Progressive Web App (PWA)**:
  * Aplicativo instalável no celular ou desktop com suporte offline básico e ícones customizados.

---

## 🛠️ Stack Tecnológica

* **Frontend**: [Angular](https://angular.dev/) (Versão 20+ com standalone components, Signals e SSR).
* **Styling**: CSS Custom Properties (Design System moderno e responsivo).
* **BaaS (Backend-as-a-Service)**: [Firebase](https://firebase.google.com/) (Authentication, Cloud Firestore).
* **CDN / Object Storage**: [Tebi](https://tebi.io/) (Armazenamento compatível com S3 para mídias).
* **Serviço de E-mail**: [EmailJS](https://www.emailjs.com/).

---

## ⚙️ Configuração do Ambiente

O projeto utiliza um script dinâmico para gerar os arquivos de ambiente do Angular a partir de um arquivo `.env` seguro.

1. Duplique o arquivo `.env.example` na raiz do projeto e renomeie-o para `.env`:
   ```bash
   cp .env.example .env
   ```
2. Abra o arquivo `.env` e preencha as variáveis de ambiente com suas credenciais:
   * **Firebase Prod & Dev**: Credenciais dos projetos do Firebase de Produção e Desenvolvimento.
   * **Tebi Storage**: Suas chaves de acesso (Access Key e Secret Key) da Tebi.
   * **EmailJS**: Seus identificadores do EmailJS para envio de newsletters.

---

## 🏃 Como Rodar Localmente

### 1. Instalar as dependências
```bash
npm install
```

### 2. Iniciar o servidor de desenvolvimento
```bash
npm start
```
> 💡 *O comando de inicialização roda automaticamente o script `scripts/set-env.js` no hook `prestart`, gerando os arquivos de ambiente em `src/environments/` com base no seu `.env`.*

Abra [http://localhost:4200](http://localhost:4200) no seu navegador para ver o aplicativo rodando.

---

## 📦 Build e Deploy

### Build de Produção
Para gerar a build de produção otimizada:
```bash
npm run build
```

### Deploy na Vercel
1. Instale a CLI da Vercel ou conecte o repositório ao painel da Vercel.
2. Certifique-se de configurar todas as variáveis do `.env.example` diretamente na aba **Environment Variables** do seu projeto na Vercel.
3. O build script executará a geração dos arquivos de ambiente na nuvem automaticamente.

---

## 📂 Estrutura de Pastas Relevante

```text
├── public/                  # Arquivos estáticos e PWA manifest
├── scripts/                 # Scripts auxiliares (como set-env.js)
├── src/
│   ├── app/
│   │   ├── core/            # Serviços singleton, guards e lógica de banco
│   │   │   ├── db/          # Serviços modulares do Firestore
│   │   │   └── models/      # Interfaces de dados
│   │   └── features/        # Componentes e páginas (admin, auth, feed)
│   └── environments/        # Configurações de ambiente (gerados dinamicamente)
```

---

## 📄 Licença

Este projeto é de uso privado. Todos os direitos reservados.
