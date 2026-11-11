/**
 * Shared browser JS interpolated into dashboard, agent window, and main-grid HTML.
 * AUTH_TOKEN must already be defined in the page script. Query param is `token=`.
 * apiJson also sends Authorization: Bearer when AUTH_TOKEN is set.
 */
export function clientApiJavaScript(): string {
  return `
      function withToken(path){
        if(!AUTH_TOKEN){ return path; }
        const glue = path.includes('?') ? '&' : '?';
        return path + glue + 'token=' + encodeURIComponent(AUTH_TOKEN);
      }
      async function apiJson(path, options){
        const opts = options && typeof options === "object" ? options : {};
        const headers = Object.assign({}, opts.headers || {});
        if(AUTH_TOKEN){
          headers.Authorization = "Bearer " + AUTH_TOKEN;
        }
        const res = await fetch(withToken(path), Object.assign({}, opts, { headers }));
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) {
          return { ok: false, error: "non-json " + res.status, status: res.status, raw: text.slice(0, 200) };
        }
        if (!res.ok) {
          const err = (data && (data.error || data.message)) ? (data.error || data.message) : ("HTTP " + res.status);
          return { ok: false, error: err, status: res.status, ...data };
        }
        return data && typeof data === "object" ? data : { ok: true, data: data };
      }
  `;
}

/** Question card for a blocking cursor-agent AskQuestion. Both agent surfaces share it. */
export function agentQuestionJavaScript(): string {
  return `
      function clearAgentQuestion(){
        const card = document.getElementById('agentQuestionCard');
        if(card){ card.remove(); }
      }
      function renderAgentQuestion(raw){
        let payload = raw;
        if(typeof raw === 'string'){
          try { payload = JSON.parse(raw); } catch(_e){ return; }
        }
        if(!payload || payload.state !== 'pending' || !Array.isArray(payload.questions) || payload.questions.length === 0){
          clearAgentQuestion();
          return;
        }
        clearAgentQuestion();
        const root = document.getElementById('chatHistory');
        if(!root){ return; }
        const card = document.createElement('div');
        card.id = 'agentQuestionCard';
        card.className = 'chatMsg agentQuestion';
        const role = document.createElement('div');
        role.className = 'chatRole';
        role.textContent = 'question';
        card.appendChild(role);
        if(payload.title){
          const title = document.createElement('div');
          title.className = 'qTitle';
          title.textContent = String(payload.title);
          card.appendChild(title);
        }
        for(const question of payload.questions){
          const prompt = document.createElement('div');
          prompt.className = 'qPrompt';
          prompt.textContent = String(question.prompt || '');
          card.appendChild(prompt);
          const options = document.createElement('div');
          options.className = 'qOptions';
          for(const option of (question.options || [])){
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = question.allowMultiple ? 'checkbox' : 'radio';
            input.name = 'winnow-q-' + String(question.id);
            input.value = String(option.id || '');
            const span = document.createElement('span');
            span.textContent = String(option.label || option.id || '');
            label.appendChild(input);
            label.appendChild(span);
            options.appendChild(label);
          }
          card.appendChild(options);
        }
        const actions = document.createElement('div');
        actions.className = 'qActions';
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.textContent = 'Answer';
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.textContent = 'Skip';
        const note = document.createElement('div');
        note.className = 'qNote';
        function selectedLabels(question){
          const selector = 'input[name="winnow-q-' + String(question.id) + '"]:checked';
          const selected = new Set(Array.from(card.querySelectorAll(selector)).map((el) => el.value));
          return (question.options || []).filter((option) => selected.has(String(option.id))).map((option) => String(option.label || option.id));
        }
        async function send(outcome){
          if(outcome === 'skipped'){
            clearAgentQuestion();
            return;
          }
          const lines = ['The earlier skip was automatic. These are my actual answers:'];
          for(const question of payload.questions){
            const labels = selectedLabels(question);
            if(labels.length === 0){
              note.textContent = 'Choose an option for each question.';
              return;
            }
            if(!question.allowMultiple && labels.length !== 1){
              note.textContent = 'Choose one option for each question.';
              return;
            }
            lines.push('- ' + String(question.prompt || 'Question') + ': ' + labels.join(', '));
          }
          lines.push('Continue using these answers.');
          submit.disabled = true;
          skip.disabled = true;
          note.textContent = '';
          if(typeof submitAgentQuestionAnswer !== 'function'){
            submit.disabled = false;
            skip.disabled = false;
            note.textContent = 'This view cannot send an answer.';
            return;
          }
          try {
            await submitAgentQuestionAnswer(lines.join('\\n'));
            clearAgentQuestion();
          } catch (err) {
            submit.disabled = false;
            skip.disabled = false;
            note.textContent = err && err.message ? String(err.message) : 'Could not send the answer.';
          }
        }
        submit.addEventListener('click', () => { void send('answered'); });
        skip.addEventListener('click', () => { void send('skipped'); });
        actions.appendChild(submit);
        actions.appendChild(skip);
        card.appendChild(actions);
        card.appendChild(note);
        root.appendChild(card);
        if(typeof root.scrollTop === 'number'){
          root.scrollTop = root.scrollHeight;
        }
      }
  `;
}
