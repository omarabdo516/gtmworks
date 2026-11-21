// The title of a Conversation the morning opened (#183; design-reference: the morning thread's title): "Good morning ·
// Wed, Nov 11", or «صباح الخير · الأربع 11 نوفمبر», from the day the morning greets, in the reader's language.
/** @param {(key:string,...values:unknown[])=>string} t @param {string} language @param {string} day YYYY-MM-DD */
export function morningTitle(t,language,day) {
 const at=new Date(`${day}T12:00:00Z`);
 if(Number.isNaN(at.getTime())) return t('goodMorningTitle','');
 const date=language==='ar'
  ?`${t(`routineWeekday${at.getUTCDay()}`)} ${at.getUTCDate()} ${new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'UTC',month:'long'}).format(at)}`
  :new Intl.DateTimeFormat('en-US-u-nu-latn',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(at);
 return t('goodMorningTitle',date);
}
