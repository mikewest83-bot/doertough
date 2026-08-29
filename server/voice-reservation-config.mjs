export function voiceReservationLimits({ paidAccess, maxSessionSeconds, paidSessionLimit, freeSessionLimit, globalSessionLimit, paidMinuteLimit, freeMinuteLimit, globalMinuteLimit }) {
  return {
    accountSessionLimit: paidAccess ? paidSessionLimit : freeSessionLimit,
    accountSecondLimit: (paidAccess ? paidMinuteLimit : freeMinuteLimit) * 60,
    globalSessionLimit,
    globalSecondLimit: globalMinuteLimit * 60,
    maxSessionSeconds,
  };
}
