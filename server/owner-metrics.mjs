import { query } from './db.mjs';

const safe = async (label, fn) => {
  try { return await fn(); }
  catch (error) { console.error(`[owner-metrics] ${label} failed:`, error.message || error); return null; }
};
const one = async (sql, params = []) => (await query(sql, params)).rows[0] || {};
const many = async (sql, params = []) => (await query(sql, params)).rows;

export async function getOwnerMetrics() {
  const [overview, growth, subscriptions, voice, access] = await Promise.all([
    safe('overview', () => one(`SELECT
      COUNT(*)::int accounts,
      COUNT(*) FILTER (WHERE plan='pro' AND subscription_status IN ('active','trialing') AND (current_period_end IS NULL OR current_period_end>=now()))::int paying,
      COUNT(*) FILTER (WHERE subscription_status='trialing' AND (trial_end IS NULL OR trial_end>=now()))::int trialing,
      COUNT(*) FILTER (WHERE subscription_status='past_due')::int past_due,
      COUNT(*) FILTER (WHERE subscription_status='canceled')::int canceled,
      COUNT(*) FILTER (WHERE created_at>=now()-interval '7 days')::int new_this_week,
      COUNT(*) FILTER (WHERE last_seen_at>=now()-interval '1 day')::int active_today,
      COUNT(*) FILTER (WHERE plan='pro' AND current_period_end IS NOT NULL AND current_period_end<now())::int entitled_past_period
      FROM users`)),
    safe('growth', async () => ({
      bars: await many(`SELECT day::date date, COUNT(u.id)::int signups FROM generate_series(current_date-interval '13 days',current_date,interval '1 day') day LEFT JOIN users u ON u.created_at::date=day::date GROUP BY day::date ORDER BY day::date`),
      signups: await many(`SELECT id,name,email,plan,subscription_status,created_at FROM users ORDER BY created_at DESC LIMIT 8`),
    })),
    safe('subscriptions', async () => ({
      trialsEnding: await many(`SELECT id,name,email,trial_end FROM users WHERE subscription_status='trialing' AND trial_end IS NOT NULL AND trial_end>=now() AND trial_end<=now()+interval '3 days' ORDER BY trial_end`),
      pastDue: await many(`SELECT id,name,email,current_period_end FROM users WHERE subscription_status='past_due' ORDER BY current_period_end ASC NULLS LAST`),
      canceled: await many(`SELECT id,name,email,current_period_end FROM users WHERE subscription_status='canceled' ORDER BY current_period_end DESC NULLS LAST LIMIT 25`),
    })),
    safe('voice', () => one(`SELECT
      COALESCE(SUM(CASE WHEN actual_seconds IS NULL THEN reserved_seconds ELSE actual_seconds END),0)::bigint billed_seconds,
      COUNT(*)::int sessions, COUNT(DISTINCT user_id)::int callers,
      COUNT(*) FILTER (WHERE actual_seconds IS NULL)::int never_settled
      FROM voice_sessions WHERE started_at>=now()-interval '30 days'`)),
    safe('access', () => many(`SELECT role,COUNT(*)::int count FROM users GROUP BY role ORDER BY role`)),
  ]);

  const voicePoolMinutes = Number(process.env.VOICE_MINUTES_GLOBAL || 5000);
  const voiceMinutes = voice ? Number(voice.billed_seconds || 0) / 60 : null;
  const alerts = [];
  if (subscriptions?.trialsEnding?.length) alerts.push({type:'warning',text:`${subscriptions.trialsEnding.length} trial${subscriptions.trialsEnding.length===1?'':'s'} ending within 3 days`});
  if (overview?.past_due) alerts.push({type:'danger',text:`${overview.past_due} past-due subscription${overview.past_due===1?'':'s'}`});
  if (overview?.entitled_past_period) alerts.push({type:'danger',text:`${overview.entitled_past_period} account${overview.entitled_past_period===1?'':'s'} entitled past paid period end`});
  if (voice?.never_settled) alerts.push({type:'danger',text:`${voice.never_settled} voice session${voice.never_settled===1?'':'s'} never settled`});
  if (voice && voicePoolMinutes && voiceMinutes / voicePoolMinutes > .75) alerts.push({type:'danger',text:'Voice pool is above 75% of the 30-day ceiling'});

  return {
    overview: overview ? { accounts:overview.accounts||0,paying:overview.paying||0,trialing:overview.trialing||0,pastDue:overview.past_due||0,canceled:overview.canceled||0,newThisWeek:overview.new_this_week||0,activeToday:overview.active_today||0,entitledPastPeriod:overview.entitled_past_period||0,paidPlanPercent:overview.accounts?Math.round(overview.paying/overview.accounts*100):0,mrr:null,trialMrr:null } : null,
    growth, subscriptions,
    voice: voice ? {minutes:Math.round(voiceMinutes*10)/10,poolMinutes:voicePoolMinutes,poolPercent:voicePoolMinutes?Math.round(voiceMinutes/voicePoolMinutes*100):0,sessions:voice.sessions||0,callers:voice.callers||0,neverSettled:voice.never_settled||0} : null,
    access: access ? {roles:Object.fromEntries(access.map(r=>[r.role,Number(r.count)])),configured:true} : null,
    alerts: overview && subscriptions && voice ? alerts : [],
    configured: true,
  };
}
