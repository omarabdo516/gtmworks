# gtmworks

A self-hosted marketing operating system that the person who installs it runs for one or many companies: monthly strategy, content calendar, captions, designs, publishing, metrics and comments, each company kept apart from the others.

## Language

The UI defaults to English and ships a complete Arabic translation in Egyptian Arabic, worded as in the approved reference. Each person chooses their account language. Direction follows that language; authored content keeps its own direction. Every new interface string is added to both catalogues.

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
A named worker running in Hermes, attached to a Company with a free name and speciality. On the bundled Engine an Agent is one Engine profile, with its own memory, Skills and settings (ADR 0016); the people who talk to the same Agent share its memory. Each Company has one default Agent for new conversations, its main Agent. A profile serves one Company only, inside that Company's own Engine (ADR 0018); the bundled Hermes is the only kind of Engine (ADR 0017). Legacy role agents retain their company grants during the transition. An Agent never approves or rejects a Version. It gets the Engine's full power: it may publish and spend, through its apps or on its Screen, when a Member asks, with no Approval first (ADR 0020).

**Main Agent / الوكيل الرئيسي**:
The Company's default Agent, the one people talk to first, and the manager of the Company's team: it hands a job to the Agent that does it, offers to make an Agent for recurring or specialist work no Agent does, and does small one-off jobs itself. On a new Company it opens the first Conversation, with a few questions about the Company and the first Agents it proposes to make (Omar, 2026-11-20). The bundled Engine names it Lead; a Company has one at a time, and an Owner may make another of its Agents the main one. The Agent that was main when its Company moved to a profile per Agent keeps the Company's first profile, `co-<company id>`, with everything in it; every other Agent gets `ag-<agent id>`.
_Avoid_: default bot, assistant, orchestrator

**Look / شكل الوكيل**:
An Agent's shape, colour and temperament, the same for everyone in its Company. It is given when the Agent is made and stays its own, after the Agent is removed too. Each of the three is automatic until an Owner picks it, and may be reset to automatic. Only an Owner changes it.
_Avoid_: avatar, theme, skin, picture

**Temperament / طبع**:
The character an Agent's face carries: calm, energetic, warm, dreamy, neat or caring, shown by its eyes, its breath and the way it looks around. It changes nothing in how the Agent works or writes.
_Avoid_: personality, mood, tone, soul

**Expression / تعبير**:
What an Agent's face shows of its state, as far as the reader may know it: idle, listening (the reader is typing to it), thinking, working, done, waiting on the reader, stuck (its last Run the reader can see failed; a person stopping it is not being stuck) or asleep (no work for 7 days).
_Avoid_: emotion, mood, status icon

**Agent request / طلب وكيل**:
A Manager's or Contributor's ask for a new Agent, which the main Agent prepares in their Conversation and which waits in every Owner's "Waiting on you". An Owner makes it, exactly as when the Owner asks the main Agent, or says no with a reason that goes back to the Member's Conversation. Only an Owner makes Agents.
_Avoid_: proposal, ticket

**Request to open an Agent / طلب فتح وكيل**:
A Manager's or Contributor's ask to work with an Agent hidden from them. When they ask the main Agent for work that belongs to such an Agent, the main Agent says that job belongs to an Agent they do not have, without naming it, and its card asks whether to request it from the person who chooses which Agents they work with. Their "Ask" puts it in the "Waiting on you" of the Owner and of every Manager who sees that Agent; one of them opens it for them (that Member's switch for that Agent) or says no, and the answer comes back to the Member's Conversation.
_Avoid_: access ticket, permission request

**Change proposal / اقتراح تغيير**:
An Agent's ask to change its own settings, or Lead's on another Agent's behalf: its model, its core instructions, its sub-agents or one of the Engine settings gtmworks lists, with the reason. It waits in every Owner's "Waiting on you" and changes nothing until an Owner approves it; approved, it is written to that Agent's own Engine profile and read back; declined, nothing changes. Anything off that list is refused at once and waits on nobody. An app is asked for with the connect card, not proposed; the Agent's own memory and Skills follow its learning mode (#19). The Owner may edit the proposed value before approving it ("Edit, then approve"); the proposal keeps both the value proposed and the value approved (#484).
_Avoid_: settings request, config change

**Handover / تسليم**:
An Agent's ask to another Agent of the same Company for a job it needs done, made while it works for a person. Any Agent may hand over to any other Agent of its Company, in a Conversation or a channel, including an Agent outside that channel or one the person cannot talk to; the Agent asked may hand over in turn, with no limit on the chain. The Agent asked works with all its own tools but never speaks to the person: what it needs from them goes back in its answer. The answer always returns to the Agent that asked, which goes on with the job and replies; the person keeps talking to the Agent they started with. Each Handover shows where it happened as a quiet row naming both Agents, with the answer under the asked Agent's own name (Omar, 2026-11-20).
_Avoid_: delegation, subagent, A2A, Handed to you

**Run / تشغيل**:
One attempt by an agent to work on one card in one company, with a short-lived credential limited to that card and run. A retry keeps the same card; execution happens outside gtmworks.

**Conversation / محادثة**:
One person's exchange with one Agent, started from New. It stays with that Agent for its whole life and maps to one session in the Agent's Engine (a Hermes session today), where the Agent's working context lives. gtmworks keeps its own append-only record of it as people saw it: who wrote each message, the Agent's reply and the time; the copy flows one way, from Hermes to gtmworks. A conversation is private to the person who started it. Any Member except a Viewer may start or write in one.
_Avoid_: chat, thread, session

**Step / خطوة**:
One tool call the Engine reported for the Run behind an Agent's reply in a Conversation, listed under the reply's sender line as the Engine reported it: the tool's name, the Engine's own preview of the call (left out when it holds a path, a key or the Engine's name), and whether the call ended ("Done") or failed ("Skipped"). gtmworks writes no step of its own. A Run's steps are kept once, when it closes completed; a failed or stopped Run, and one whose events were lost before they were read, shows none.
_Avoid_: action, task, activity

**Channel / قناة**:
A conversation that a Company's Members and Agents share, where an Agent reads and replies only when a message calls it by name. A Company that works as a team has its general channel («عام»), which holds every Member; an Owner or a Manager makes a team channel, for a campaign or a department, with the Members and Agents they choose, and changes both later. A Member outside a team channel does not see that it exists, the Owner included. Inside a channel its Members see and call its Agents, even one hidden from them elsewhere; outside it nothing changes, and a direct Conversation with that Agent stays impossible. Each Member's unread count is the messages others wrote since they last opened it.
_Avoid_: room, group chat, thread

**Engine / المحرك**:
The agent program that runs a Conversation's replies, today the Hermes that ships inside the install (ADR 0010). gtmworks talks to every engine through one engine contract (start a run with an idempotency key, read its state, usage and steps, stop it); a driver is the code that speaks the contract for one engine. gtmworks writes no model loop of its own. Each Company has its own Engine, kept apart from every other Company's.
_Avoid_: model, provider, backend

**Provider / مزوّد**:
One way a Company's Engine reaches models: a subscription the Company signed in to, such as Claude or ChatGPT, or an API key, with the name the Owner gives it, such as "Claude · Said". A Company may hold several, of one kind or of different kinds. They belong to the whole Company, never to one Agent: an Agent chooses a model, and the Engine chooses the Provider it reaches that model through, moving to the next one of the same kind, in the Owner's order, when one runs out. Only the Owner adds, orders or switches off a Provider. Each Provider lists the models it offers, and only the ones switched on are offered when a model is chosen.
_Avoid_: account, subscription, key, connection

**Fallback model / الموديل البديل**:
The model a Company's Agents move to when every Provider of the model they chose has run out. There is none until the Owner picks one, and with none an Agent never moves to another kind of Provider.
_Avoid_: backup model, failover

**Work sandbox / صندوق الشغل**:
A Company's own machine for its Agents' work: commands, files, code, a Screen with a browser, and video rendering. Every Agent of the Company works in the same one, so anything in it can be seen by any Member who talks to any of the Company's Agents. It holds no key of any kind. From inside it nothing of another Company, of the Engine or of the install can be reached; it reaches the internet only.
_Avoid_: container, VM, workspace, environment

**Screen / الشاشة**:
The desktop and browser an Agent works on, inside its Company's Work sandbox. A Company has one, shared by its Agents: one display and one browser profile, so one Screen is awake per Company at a time, whichever Agent is using it (vault decision 0068). A Member can watch it and take it over, for example to sign in to an account. Whatever a person signs in to on the Screen, every Agent of the Company can use, within that account's own permissions.
_Avoid_: bot screen, remote desktop, browser session

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
The role that can do everything in its company; only an Owner can make another member an Owner. The first person through first-run is the first company's Owner; a Company made later gets its first Owner through a first-Owner link from the install owner, which works once. A company always has at least one.
_Avoid_: admin, super admin

**Install owner / صاحب التثبيت**:
The person who runs the install from its server: installs and updates it, makes Companies, and sets how people reach it. An install owner enters a Company only as one of its Members.
_Avoid_: admin, super admin, agency, instance admin

**Updater / المحدّث**:
The small timer the install puts on its server, run as the install owner, that carries out Update now and automatic updates by running `gtmworks update` itself. The app only asks it; it chooses the version (ADR 0020).
_Avoid_: auto-updater service, update daemon

**Invite link / لينك دعوة**:
A link an Owner makes to bring one new Person into a Company, with the Role they will hold and the Agents they will see. It works once, ends after 7 days, and can be cancelled before it is used. It never gives the Owner role: an Owner makes an existing Member an Owner.
_Avoid_: invitation email, magic link

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
One item of work on the board, with a title, a description, an assignee or nobody yet, a status (the column it is in), a result and comments everyone who sees it reads. A person or an Agent makes it. Its files, Versions and log stay with it. The Arabic plural is «بطاقات».
_Avoid_: كارت, كروت, task, ticket

**Assignee / المسؤول**:
The one Agent or Member whose job a Card is. A Card has at most one; an idea often has none.
_Avoid_: next actor, owner, assigned to several

**Archived / مؤرشف**:
Out of the board, the lists and the counts, with everything in it kept, until a person restores it. Said of a Card, a Conversation or a team channel; none of them is deleted.
_Avoid_: deleted, removed, hidden, closed

**Attachment / مرفق**:
A file or reference image attached to a card or to one of its comments. It stays inside the company's storage; a person reads it by its number on the card, and only members of that company reach it. A design version is not an attachment.
_Avoid_: upload, evidence file

**Version / نسخة**:
One saved revision of a card's output. Editing creates a new version; approving an earlier version never authorizes a later one.

**Approval / موافقة**:
A permitted person's decision on one exact version, recorded with who approved it. An agent cannot approve its own or another agent's work. It is the team's record, not a gate an agent's tools wait on (ADR 0020).

**Permission request / طلب موافقة**:
The engine's own stop inside a run before an action: the agent waits until the conversation's person answers "Allow once", "Always allow" or "Don't allow", or the engine stops waiting, which counts as not allowed. It is not an approval of a version. "Always allow" stays with Owners and Managers, and only on an agent's own engine profile.

**Handed to you / اتسلّمت لك**:
A step no agent may do, such as publishing where there is no API or paying an invoice. The agent prepares it; a person does it and marks "I did it" against the approved version. The record shows who did it; approval alone does not record that the step was done.

**Project / مشروع**:
The cards of one company goal, with a name, goal, status (active, paused or done), linked Offering and Key date, Ad campaigns and Results. A card belongs to at most one project of its own company. A project is not an Ad campaign.

**Routine / مهمة متكررة**:
Recurring work specifying who, what and when; each occurrence creates an ordinary card. The team may pause or reschedule it; three untouched occurrences raise an alert.

**Skill / مهارة**:
Instructions in SKILL.md, kept only in the Engine (ADR 0017): in an Agent's own profile, or in the Company's shared Skills. An Owner or a Manager writes one into an Agent's own profile or switches it off or on for that Agent; each change is checked on the server and written in the company's log. The shared Skills' names (`team-lessons`, `company-knowledge`) are never taken by an Agent's own skill.

**Company's shared Skills / مهارات الشركة المشتركة**:
One folder of Skills per Company, kept in the Company's shared space (`cs-<company id>`), which every Agent of that Company reads. A lesson approved for the whole team lands there. No Run ever starts on the shared space.
_Avoid_: team skills, global skills

**Install-wide / للتثبيت كله**:
A setting the install holds once for every Company, such as the address people reach it at. Changing it changes it for every Company. A model sign-in is never install-wide: each Company signs in on its own Engine.
_Avoid_: global, system-wide, default

**Lesson / درس**:
A lasting rule a Contributor taught an agent, suggested for the whole team. It waits in "Waiting on you" for the company's Owner and Managers; nothing reaches any agent until one approves it, when it lands in the shared Skill `team-lessons`, and a rejected lesson never does.
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
