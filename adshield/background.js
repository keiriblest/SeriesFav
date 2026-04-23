let blocked = 0;

chrome.declarativeNetRequest.onRuleMatchedDebug && 
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
  blocked++;
  chrome.action.setBadgeText({ text: blocked > 999 ? '999+' : String(blocked) });
  chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'BLOCKED') {
    blocked++;
    chrome.action.setBadgeText({ text: blocked > 999 ? '999+' : String(blocked) });
    chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
  }
  if (msg.type === 'GET_COUNT') reply({ count: blocked });
});
