# gtmworks

A self-hosted marketing operating system that the person who installs it runs for one or many companies: monthly strategy, content calendar, captions, designs, publishing, metrics and comments, each company kept apart from the others.

## Language

The UI defaults to English and ships a complete Modern Standard Arabic translation. Each person chooses their account language. Direction follows that language; authored content keeps its own direction. Every new interface string is added to both catalogues.

Sidebar labels: Search / بحث; Home / الرئيسية; Inbox / الوارد; Work / الشغل (Work / العمل, Projects / المشاريع, Routines / المهام المتكررة, Campaigns / الحملات, Library / المكتبة, Publishing / النشر); Results / النتائج; Team / الفريق (Agents / الوكلاء والأتمتة, Skills / المهارات, Connections / الربط, Activity log / السجل); Agents / الوكلاء (Company chat / محادثة الشركة, Account manager / مدير الحساب, Writer / الكاتب, Designer / المصمم, Critic / الناقد); Recent / آخر البطاقات.

Permission roles: Owner / مالك; Manager / مدير; Contributor / مساهم; Viewer / مشاهد.

### Who

**Company / شركة**:
One client business served by the product, with its own data, connected accounts and voice. RS, Aleem and Rayan & Samir are three separate companies.
_Avoid_: tenant, brand, client, account, workspace

**Person / شخص**:
Someone who signs in to the product. A person on their own has access to nothing.
_Avoid_: user, account

**Member / عضو**:
A person's place in one company, carrying the role they hold there. One person can be a member of many companies with a different role in each.
_Avoid_: user, seat, staff

**Agent / وكيل**:
A named worker running in Hermes, attached to a Company with a free name and speciality. Each Company has one default Agent for new conversations, its main Agent. A Hermes profile normally serves one Company because its memory belongs to that profile; an Owner must explicitly confirm the memory-sharing warning before attaching it to another Company. Legacy role agents retain their company grants during the transition. An Agent never approves, rejects, publishes or spends at this stage.

**Main Agent / الوكيل الرئيسي**:
The Company's default Agent, the one people talk to first. The bundled Engine names it Lead; a Company has one at a time, and an Owner may make another of its Agents the main one.
_Avoid_: default bot, assistant, orchestrator

**Run / تشغيل**:
One attempt by an agent to work on one card in one company, with a short-lived credential limited to that card and run. A retry keeps the same card; execution happens outside gtmworks.

**Conversation / محادثة**:
One person's exchange with one Agent, started from New. It stays with that Agent for its whole life and maps to one session in the Agent's Engine (a Hermes session today), where the Agent's working context lives. gtmworks keeps its own append-only record of it as people saw it: who wrote each message, the Agent's reply and the time; the copy flows one way, from Hermes to gtmworks. A conversation is private to the person who started it. Any Member except a Viewer may start or write in one.
_Avoid_: chat, thread, session

**Engine / المحرك**:
The agent program that runs a Conversation's replies, today the Hermes that ships inside the install (ADR 0010). gtmworks talks to every engine through one engine contract (start a run with an idempotency key, read its state and usage, stop it); a driver is the code that speaks the contract for one engine. gtmworks writes no model loop of its own.
_Avoid_: model, provider, backend

**Waiting / في الانتظار**:
The planned run status `waiting`: the run delivered a version or asked a question and is waiting for a person. An open interrupt blocks progress until answered or abandoned; no answer is never yes.

**Cancelled / ملغي**:
The planned run status `cancelled`: a person or gtmworks stopped the run.

**Company grant / إتاحة شركة**:
An Owner's permission for one agent to work in one company, kept as one row per company and agent. Without an active grant the agent sees and writes nothing there and receives not found. Revoking keeps the row with who revoked it and when; granting and revoking are recorded in the company's activity record with the acting person.
_Avoid_: access key, invitation, membership

**Agent role key / مفتاح دور الوكيل**:
A stable designation identifying a company's account manager, writer, designer or critic independently of the person's name. Only a Contributor may hold one; each designation belongs to at most one active member per company. Other members have none.
_Avoid_: display name, person identity, permission role

**Role / دور**:
The named set of permissions a member holds in one company: Owner, Manager, Contributor, or Viewer. Owners and Managers approve; Contributors and Viewers never do. Each company may change what every role except Owner may do.
_Avoid_: group, user type, access level

**Grant / صلاحية منفصلة**:
A separate per-member permission in one company: publishing, money figures, or customer data.

**Permission / صلاحية**:
One thing a role allows in a company, such as approving a post, sending a comment reply, or connecting accounts.
_Avoid_: right, privilege, scope

**Owner / مالك**:
The role that can do everything in its company; only an Owner can make another member an Owner. The first person through first-run is the first company's Owner. A company always has at least one.
_Avoid_: admin, super admin

**Connection / ربط**:
A company's link to an outside account or tool, such as Facebook, Google Ads, Odoo or an MCP tool. It belongs to one company and is made by a member allowed to connect accounts. Keys are encrypted and never shown to agents; model credentials stay outside gtmworks.
_Avoid_: integration, account, credential, token

### What a company sells, and to whom

**Offering / عرض**:
The thing a company's content promotes, named the way its marketing names it: a course, a service, a collection. Each company's team writes its own list, and an offering may be linked to one or more of the company's Odoo products so its sales and dates can be read.
_Avoid_: product, offer, workshop, service, SKU

**Segment / شريحة**:
A group of people a company's content speaks to, with a name, a description and the problem they have. Each company keeps its own list; one offering can target many segments, and one segment can be shown many offerings.
_Avoid_: audience, persona, target

**Key date / تاريخ مهم**:
A date a company's content is built around: the start of a run of an offering, a season, a deadline. It belongs either to one offering or to the whole company. It is written by the team, or read from the company's Odoo events for a linked offering.
_Avoid_: event, cohort, run, season event

### How content is organised

**Card / بطاقة**:
One item of work in a company's workflow, with its stage, owner and activity. The Arabic plural is «بطاقات».
_Avoid_: كارت, كروت

**Mode / وضع**:
What a new card asks its agent to do: plan first (write a plan and wait for approval), do it now, or just answer. A person chooses it with the first message when the card is created, and the card shows it.
_Avoid_: type, status, priority

**Attachment / مرفق**:
A file or reference image a person attaches to a card's first message or to a reply. It stays inside the company's storage; a person or an agent reads it by its number on the card, and the agent's run key reaches only its own card's attachments. A design version is not an attachment.
_Avoid_: upload, evidence file

**Version / نسخة**:
One saved revision of a card's output. Editing creates a new version; approving an earlier version never authorizes a later one.

**Approval / موافقة**:
A permitted person's decision on one exact version, recorded with who approved it. An agent cannot approve its own or another agent's work.

**Handed to you / اتسلّمت لك**:
A step no agent may do, such as publishing where there is no API or paying an invoice. The agent prepares it; a person does it and marks "I did it" against the approved version. The record shows who did it; approval alone does not record that the step was done.

**Project / مشروع**:
The cards of one company goal, with a name, goal, status (active, paused or done), linked Offering and Key date, Ad campaigns and Results. A card belongs to at most one project of its own company. A project is not an Ad campaign.

**Routine / مهمة متكررة**:
Recurring work specifying who, what and when; each occurrence creates an ordinary card. The team may pause or reschedule it; three untouched occurrences raise an alert.

**Skill / مهارة**:
Instructions in SKILL.md enabled per agent per company and loaded by its runtime. Any team member may install one; outside skills are scanned before enabling, and installs and enables are audited. Agent-written lessons retain their source edit or rejection and can be cancelled.

**Lesson / درس**:
One thing an agent learned on a card, proposed as a single added line in one of its skills, with the reason and the card it was learned on. It waits in the Inbox of the people who manage the company; nothing reaches the skill until one approves it, and a rejected lesson never does.
_Avoid_: memory, note, feedback

**Inbox / الوارد**:
What waits for one person: approvals first, agents' questions, cards awaiting their turn, and stopped or failed work. Includes notifications and My work.

**Pillar / ركيزة محتوى**:
A kind of content a company publishes, with a target share of its posts (RS: promotional, educational, interactive). Each company keeps its own list.
_Avoid_: content type, category

**Diagnosis / تشخيص**:
The monthly read of last month's results and the data the team entered, written by the AI and approved inside the company before the monthly plan is made.
_Avoid_: POV, audit, report

**Monthly plan / خطة شهرية**:
A company's posts for one month, each with a date, pillar, offering, segment and hook, built from the approved diagnosis and shown as the calendar.
_Avoid_: strategy, content plan, campaign

**Post / منشور**:
One piece of content in the monthly plan: a caption and its media (an image, a carousel or a video), approved inside the company, then published on its own at its scheduled time.
_Avoid_: content, creative, publication

**Ad campaign / حملة إعلانية**:
A campaign as Meta or Google Ads define it, with its own budget. The product has no campaign of its own.
_Avoid_: campaign, for any grouping of posts

### How a company sounds

**Voice / صوت الشركة**:
How a company's posts sound: its base tone, its dialect, examples of posts that worked, its fixed calls to action and hashtags, and an optional tone note per platform and per pillar. Each company keeps its own, and every change makes a new version.
_Avoid_: brand book, tone of voice guide, persona

**Content rule / قاعدة محتوى**:
One thing a company's posts must not say or must follow, such as a banned word, a ban on prices, or "never promise a medical result". Each company writes its own; the AI is told every rule before writing, and every rule is checked after.
_Avoid_: guideline, policy, compliance rule, anti-pattern

**Brand check / فحص هوية الشركة**:
The check of a post against its company's voice and content rules, run after the caption is written and on every edit. It marks problems on the post; the member who approves decides.
_Avoid_: quality gate, compliance check, review

### How results are measured

**Result / نتيجة**:
A number about a company's marketing for a period (leads by source, sales per offering, ad spend, clicks), read from one of its connections or typed in by the team. Money results (ad spend, sales amounts) are shown only to members whose role allows it.
_Avoid_: KPI, metric, report, analytics
