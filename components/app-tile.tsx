import type { ReactNode } from 'react';
import { apps as catalogue } from '@/lib/app-catalogue.mjs';
import { roleApps } from '@/lib/role-templates.mjs';

// The reference's app tile (design-reference/app.js `tile`, index.html .tool-tile): the brand mark where the reference
// draws one (shapes from Simple Icons, CC0, in each brand's own colours), otherwise the app's letters. It never names the
// app: the name is beside it, or in the line that lists the apps.
const logos:Record<string,ReactNode>={
 meta: <path fill="#0081FB" d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"/>,
 gads: <><path fill="#FBBC04" d="M7.5137 4.8438L1.5645 15.1484A4.5 4.5 0 0 1 4 14.4297c2.5597-.0075 4.6248 2.1585 4.4941 4.7148l3.2168-5.5723-3.6094-6.25c-.4499-.7793-.6322-1.6394-.5878-2.4784z"/><path fill="#4285F4" d="M23.4641 16.9287L15.4632 3.072C14.3586 1.1587 11.9121.5028 9.9988 1.6074S7.4295 5.1585 8.5341 7.0718l8.0009 13.8567c1.1046 1.9133 3.5511 2.5679 5.4644 1.4646 1.9134-1.1046 2.568-3.5511 1.4647-5.4644z"/><circle fill="#34A853" cx="3.9998" cy="18.9293" r="3.9998"/></>,
 ga4: <><path fill="#F9AB00" d="M22.84 2.9982v17.9987c.0086 1.6473-1.3197 2.9897-2.967 2.9984a2.9808 2.9808 0 01-.3677-.0208c-1.528-.226-2.6477-1.5558-2.6105-3.1V3.1204c-.0369-1.5458 1.0856-2.8762 2.6157-3.1 1.6361-.1915 3.1178.9796 3.3093 2.6158.014.1201.0208.241.0202.3619z"/><path fill="#F9AB00" d="M12.0054 9.045c-.0171 0-.0342 0-.0513.0003-1.6495.0904-2.9293 1.474-2.891 3.1256v7.9846c0 2.167.9535 3.4825 2.3505 3.763 1.6118.3266 3.1832-.7152 3.5098-2.327.04-.1974.06-.3983.0593-.5998v-8.9585c.003-1.6474-1.33-2.9852-2.9773-2.9882z"/><circle fill="#E37400" cx="4.1326" cy="21.0274" r="2.9726"/></>,
 gsc: <><path fill="#4285F4" d="M3 5.5A2.5 2.5 0 0 1 5.5 3h11A2.5 2.5 0 0 1 19 5.5V9h-2.2V6.6H5.2v9.2h4.6V18H5.5A2.5 2.5 0 0 1 3 15.5z"/><circle cx="15.2" cy="15.2" r="3.9" fill="none" stroke="#34A853" strokeWidth="2.2"/><path d="M18.1 18.1l3.1 3.1" stroke="#EA4335" strokeWidth="2.4" strokeLinecap="round"/></>,
 wp: <><circle cx="12" cy="12" r="11" fill="#21759B"/><circle cx="12" cy="12" r="9.2" fill="none" stroke="#FFFFFF" strokeWidth="1"/><path d="M6.4 8.6l2.7 7.6 2.5-6.2 2.5 6.2 2.7-7.6" fill="none" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></>,
 sheets: <><path fill="#0F9D58" d="M6 1.5h8.6L20 6.9V20a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 20V4a2.5 2.5 0 0 1 2-2.5z"/><path fill="#87CEAC" d="M14.6 1.5v5.4H20z"/><path fill="#FFFFFF" d="M7.4 10.6h9.2v7.6H7.4z"/><path fill="#0F9D58" d="M8.6 11.8h2.8v1.9H8.6zm4 0h2.8v1.9h-2.8zm-4 3.1h2.8v1.9H8.6zm4 0h2.8v1.9h-2.8z"/></>,
};

export function AppTile({app,size='sm'}:{app:{key:string,mark:string},size?:'sm'|'lg'}) {
 const logo=logos[app.key];
 return <span className={size==='lg'?'tool-tile tool-tile--lg':'tool-tile'} aria-hidden="true">{logo?<svg className="tool-logo" viewBox="0 0 24 24" focusable="false">{logo}</svg>:app.mark}</span>;
}

// An app an Agent names in words (a request's apps #17, a handed step's app #139): the known app of that key or name,
// in any case, or undefined.
const known=[...Object.entries(roleApps).map(([key,app])=>({key,...app})),...catalogue];
export function knownApp(name:string) {
 const asked=name.trim().toLowerCase();
 return known.find(app=>app.key===asked||app.name.toLowerCase()===asked);
}
