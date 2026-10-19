'use client'
import {useEffect,useRef,useState,type ReactNode} from 'react'
export default function DashboardShell({email,name,environment,children}:{email:string;name:string;environment:string;children:ReactNode}) {
 const [section,setSection]=useState('profile'),[menu,setMenu]=useState(false),[mobile,setMobile]=useState(false)
 const [narrow,setNarrow]=useState(false)
 useEffect(()=>{const query=window.matchMedia('(max-width:700px)');const update=()=>setNarrow(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update)},[])
 const profile=useRef<HTMLDivElement>(null)
 useEffect(()=>{if(!menu)return;const close=(e:MouseEvent)=>{if(!profile.current?.contains(e.target as Node))setMenu(false)};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false)};document.addEventListener('mousedown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',escape)}},[menu])
 function navigate(next:string){setSection(next);setMobile(false);setMenu(false);if(['requests','suggestions'].includes(next)) window.dispatchEvent(new CustomEvent('open-change-request',{detail:{kind:next==='suggestions'?'suggestion':'change'}}))}
 return <div className="dashboard-shell">
  <aside className={`dashboard-sidebar ${mobile?'is-open':''}`} aria-label="Workspace navigation" inert={narrow&&!mobile}>
   <a href="/account" className="dashboard-brand"><span className="dashboard-mark">U</span><span>User workspace<small>vercelsupabase</small></span></a>
   <div className="dashboard-project"><span className="project-dot"/><div>User management<small>Your application</small></div></div>
   <span className="dashboard-nav-label">WORKSPACE</span>
   <nav>{[['overview','◫','Overview'],['profile','◎','Profile'],['requests','⌘','Change requests'],['suggestions','✧','Suggestions']].map(([id,icon,label])=><button key={id} className={section===id?'active':''} aria-current={section===id?'page':undefined} onClick={()=>navigate(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>
   <div className="dashboard-sidebar-footer"><span className="project-dot"/> Connected workspace<small>Changes ship after your review.</small></div>
  </aside>
  {mobile&&<button className="dashboard-backdrop" aria-label="Close navigation" onClick={()=>setMobile(false)}/>}
  <div className="dashboard-main">
   <header className="dashboard-topbar"><div className="dashboard-breadcrumb"><button className="dashboard-mobile-toggle" aria-label="Toggle navigation" aria-expanded={mobile} onClick={()=>setMobile(v=>!v)}>☰</button><span>User management</span><span className="breadcrumb-divider">/</span><strong>{section==='profile'?'Profile':section==='suggestions'?'Suggestions':section==='requests'?'Change requests':'Overview'}</strong><span className="dashboard-env">{environment}</span></div>
    <div className="dashboard-top-actions"><button className="dashboard-request-button" onClick={()=>navigate('requests')}><span aria-hidden="true">♥</span> Request a change</button>
     <div className="dashboard-profile" ref={profile}><button className="dashboard-avatar" aria-label="Open profile menu" aria-expanded={menu} aria-controls="profile-menu" onClick={()=>setMenu(v=>!v)}>{(name||email||'U').slice(0,1).toUpperCase()}</button>
      {menu&&<div id="profile-menu" className="dashboard-profile-menu"><strong>{name||'Your account'}</strong><small>{email}</small><button onClick={()=>navigate('profile')}>Manage profile</button><button onClick={()=>navigate('suggestions')}>Suggest an improvement</button><form action="/auth/signout" method="post"><button type="submit">Sign out</button></form></div>}
     </div>
    </div>
   </header>
   <main className="dashboard-content"><div className="dashboard-page-heading"><div><span className="dashboard-eyebrow">YOUR WORKSPACE</span><h1>{section==='profile'?'Your account':section==='suggestions'?'Make it better':section==='requests'?'Build the next improvement':'Welcome back'}</h1><p>{section==='profile'?'Manage your account details and profile photo.':'Manage your profile, share ideas, and review the next change to your app.'}</p></div><span className="dashboard-live"><span className="project-dot"/> Ready to build</span></div>
    {section!=='profile'&&<div className="dashboard-cards"><button onClick={()=>navigate('profile')}><span className="dashboard-card-icon">◎</span><h2>Your profile</h2><p>Keep your name, photo, and account details up to date.</p><span>Manage profile ↗</span></button><button onClick={()=>navigate('requests')}><span className="dashboard-card-icon">♥</span><h2>Request a change</h2><p>Attach a screenshot, estimate the cost, and turn an idea into a reviewed PR.</p><span>Start a request ↗</span></button><button onClick={()=>navigate('suggestions')}><span className="dashboard-card-icon">✧</span><h2>Suggest an improvement</h2><p>Share a reference or describe what would make this app more useful.</p><span>Share an idea ↗</span></button></div>}
    <section className="dashboard-profile-card"><div className="dashboard-section-heading"><div><h2>Account profile</h2><p>Your personal details in this workspace.</p></div><span>ACCOUNT</span></div>{children}</section>
   </main>
  </div>
 </div>
}
