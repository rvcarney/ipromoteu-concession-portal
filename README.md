# iPROMOTEu Concession Request Portal

A full-service internal portal for submitting, approving, and tracking concession requests.

---

## What this does

- Staff submit concession requests through a web portal
- Approvers receive an email with **Approve** and **Deny** buttons that open a real approval screen
- Decisions are recorded automatically — no copy/pasting required
- Admins see a live dashboard with metrics by request type, affiliate, staff member, and department
- The log keeper receives a copy of every decision for their records

---

## Step-by-step deployment guide

You will need:
- A free GitHub account (github.com)
- A free Railway account (railway.app)
- Your Microsoft 365 email credentials for sending emails

This takes about 20–30 minutes the first time.

---

### Step 1 — Create a GitHub account (if you don't have one)

1. Go to **github.com** and click **Sign up**
2. Follow the prompts to create a free account
3. Verify your email address

---

### Step 2 — Create a new repository on GitHub

A repository (repo) is just a folder on GitHub that holds your code.

1. Log into GitHub
2. Click the **+** button in the top right corner, then **New repository**
3. Name it: `ipromoteu-concession-portal`
4. Leave it set to **Private**
5. Click **Create repository**
6. On the next screen, you'll see a page with setup instructions — leave it open

---

### Step 3 — Upload the project files to GitHub

1. Download the zip file you received (the one containing this README)
2. Unzip it on your computer — you should see a folder called `concession-portal`
3. Go back to your new GitHub repository page
4. Click **uploading an existing file** (it's a link in the middle of the page)
5. Drag and drop **all the files and folders** from inside the `concession-portal` folder into the upload area
   - Make sure you upload the contents of the folder, not the folder itself
   - You should see: `src/`, `public/`, `db/`, `package.json`, `.gitignore`, `.env.example`, `README.md`
6. Scroll down and click **Commit changes**

Your code is now on GitHub.

---

### Step 4 — Create a Railway account

Railway is a hosting platform that will run your portal 24/7.

1. Go to **railway.app**
2. Click **Login** then **Login with GitHub**
3. Authorize Railway to access your GitHub account
4. You'll land on the Railway dashboard

---

### Step 5 — Deploy to Railway

1. In the Railway dashboard, click **New Project**
2. Click **Deploy from GitHub repo**
3. Find and select `ipromoteu-concession-portal`
4. Railway will start building your app — this takes about 2 minutes
5. Once it finishes, click on your project, then click the **Settings** tab
6. Under **Networking**, click **Generate Domain**
7. Copy the domain it gives you — it will look like `yourapp.railway.app`
   - This is your portal URL. Save it.

---

### Step 6 — Set environment variables

Environment variables are settings that tell your app how to behave. Think of them like a configuration file.

1. In your Railway project, click the **Variables** tab
2. Click **New Variable** and add each of the following one at a time:

| Variable name   | What to set it to                                      |
|-----------------|--------------------------------------------------------|
| `PORT`          | `3000`                                                 |
| `BASE_URL`      | Your Railway domain, e.g. `https://yourapp.railway.app` |
| `ADMIN_PIN`     | A PIN of your choice (change from the default `1234`) |
| `SESSION_SECRET`| Any long random string, e.g. `ipromoteu-portal-2026-secure-key-xyz` |
| `SMTP_HOST`     | `smtp.office365.com`                                   |
| `SMTP_PORT`     | `587`                                                  |
| `SMTP_SECURE`   | `false`                                                |
| `SMTP_USER`     | Your Microsoft 365 email address                       |
| `SMTP_PASS`     | Your Microsoft 365 email password (or app password)    |
| `SMTP_FROM`     | Same as `SMTP_USER`                                    |

3. After adding all variables, Railway will automatically redeploy your app

> **Note on SMTP_PASS:** If your organization uses multi-factor authentication on Microsoft 365, you may need to generate an **App Password** instead of using your regular password. To do this: go to your Microsoft account security settings, find **App passwords**, and create one specifically for this portal.

---

### Step 7 — Test your portal

1. Open your Railway domain in a browser (e.g. `https://yourapp.railway.app`)
2. You should see the staff portal with the iPROMOTEu logo and the five concession forms
3. Go to `https://yourapp.railway.app/admin` to access the admin panel
4. Log in with the PIN you set in Step 6

---

### Step 8 — Configure email routing (admin setup)

Before staff can submit requests:

1. Log into the admin panel at `/admin`
2. Go to **Email routing**
3. Set the **Log keeper email** — this person receives a copy of every decision
4. Set an approver email address for each form type
5. Click **Save all**

---

## Sharing the portal with staff

Send staff the link to your Railway domain:
```
https://yourapp.railway.app
```

Bookmark it, add it to your intranet, or share it in a Teams/Slack channel.

The admin panel is at:
```
https://yourapp.railway.app/admin
```

---

## How the approval flow works

1. Staff fills out a form and submits
2. The designated approver receives an HTML email with an **Approve** and **Deny** button
3. Clicking either button opens a page showing the full request details
4. The approver enters their name, optional notes, and confirms
5. The requester is automatically notified of the decision by email
6. The log keeper receives a summary email for their records
7. The dashboard updates immediately

---

## Keeping the portal up to date

If you need to make changes to the code and redeploy:

1. Edit the files on your computer
2. Go to your GitHub repository
3. Navigate to the file you want to update and click the pencil (edit) icon
4. Make your changes and click **Commit changes**
5. Railway will automatically detect the change and redeploy (takes about 2 minutes)

---

## Troubleshooting

**Portal won't load**
- Check the Railway dashboard — look for error logs under the **Logs** tab
- Make sure all environment variables are set correctly

**Emails aren't sending**
- Double-check `SMTP_USER` and `SMTP_PASS`
- If using MFA, make sure you're using an App Password, not your regular password
- Check Railway logs for the specific error message

**Forgot admin PIN**
- Go to Railway, click **Variables**, and update the `ADMIN_PIN` variable
- The app will redeploy automatically with the new PIN

**Database gets wiped on redeploy**
- Railway's free tier uses ephemeral storage, meaning the database resets when the app redeploys
- To persist data permanently, upgrade to Railway's Starter plan ($5/month) and add a **Volume** to your project
- In Railway: go to your project, click **New**, select **Volume**, mount it at `/app/db`

---

## Local development (optional)

If you want to run this on your own computer for testing:

1. Install Node.js from **nodejs.org** (download the LTS version)
2. Open Terminal (Mac) or Command Prompt (Windows)
3. Navigate to the project folder: `cd path/to/concession-portal`
4. Run: `npm install`
5. Copy `.env.example` to `.env` and fill in your values
6. Run: `npm start`
7. Open `http://localhost:3000` in your browser
