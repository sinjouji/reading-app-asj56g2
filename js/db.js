/* ============================================================
   db.js — 食材DBページ スクリプト
   
   ★ 追加機能: 初期賞味期限設定
      foods ドキュメントに以下フィールドを追加:
        defaultExpiryType: 'ask' | 'days' | 'none'
        defaultExpiryDays: number（typeが'days'のとき）
   ============================================================ */

initConfirmDialog();

var allFoods     = [];
var inventoryMap = {};
var currentSort  = 'name';
var filterFav    = false;
var filterExclude = false;
var filterStock  = false;
var searchQuery  = '';
var editingId    = null;
var newFoodIsFav = false;

/* 新規モーダル用：初期賞味期限設定の状態 */
var newDefaultExpiryType = 'ask';   // 'ask' | 'days' | 'none'
var newDefaultExpiryDays = null;    // 数値

/* ====================================
   Firestore リスナー（orderBy なし）
   ==================================== */
db.collection('foods').onSnapshot(function(snap) {
  allFoods = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
  renderDb();
}, function(err) {
  console.error('foods error:', err.code, err.message);
  showToast('⚠️ 食材DBの読み込みに失敗: ' + err.code);
});

db.collection('inventory').onSnapshot(function(snap) {
  inventoryMap = {};
  snap.docs.forEach(function(d) {
    var item = Object.assign({ id: d.id }, d.data());
    inventoryMap[item.foodId] = item;
  });
  renderDb();
}, function(err) {
  console.warn('inventory error:', err.code);
});


/* ====================================
   フィルター・ソートイベント
   ==================================== */
document.getElementById('dbSearch').addEventListener('input', function(e) {
  searchQuery = e.target.value.trim().toLowerCase();
  renderDb();
});
document.getElementById('dbFavFilter').addEventListener('click', function() {
  filterFav = !filterFav;
  this.classList.toggle('active', filterFav);
  renderDb();
});
document.getElementById('dbExcludeFilter').addEventListener('click', function() {
  filterExclude = !filterExclude;
  this.classList.toggle('active', filterExclude);
  renderDb();
});
document.getElementById('dbStockFilter').addEventListener('click', function() {
  filterStock = !filterStock;
  this.classList.toggle('active', filterStock);
  renderDb();
});
document.querySelectorAll('.sort-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.sort-tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    currentSort = tab.dataset.sort;
    renderDb();
  });
});

/* フィルタートグル */
var dbFilterOpen = false;
document.getElementById('dbFilterToggle').addEventListener('click', function() {
  dbFilterOpen = !dbFilterOpen;
  document.getElementById('dbFilterPanel').classList.toggle('open', dbFilterOpen);
  document.getElementById('dbFilterArrow').textContent = dbFilterOpen ? '▲' : '▼';
});


/* ====================================
   レンダリング
   ==================================== */
function renderDb() {
  var list = allFoods.slice();

  if (searchQuery)   list = suggestSort(searchQuery, list, 'name', 999);
  if (filterFav)     list = list.filter(function(f) { return f.favorite; });
  if (filterExclude) list = list.filter(function(f) { return f.excludeFromMenu; });
  if (filterStock)   list = list.filter(function(f) { return !!inventoryMap[f.id]; });

  if (currentSort === 'name') {
    list.sort(function(a, b) { return a.name.localeCompare(b.name, 'ja'); });
  } else if (currentSort === 'fav') {
    list.sort(function(a, b) {
      return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || a.name.localeCompare(b.name, 'ja');
    });
  } else if (currentSort === 'expiry') {
    list.sort(function(a, b) {
      var da = inventoryMap[a.id] ? inventoryMap[a.id].expiryDate : '9999-12-31';
      var db_ = inventoryMap[b.id] ? inventoryMap[b.id].expiryDate : '9999-12-31';
      return da.localeCompare(db_);
    });
  } else if (currentSort === 'created') {
    list.sort(function(a, b) {
      var ta = a.createdAt instanceof Date ? a.createdAt.getTime()
             : (a.createdAt && a.createdAt.seconds ? a.createdAt.seconds * 1000 : 0);
      var tb = b.createdAt instanceof Date ? b.createdAt.getTime()
             : (b.createdAt && b.createdAt.seconds ? b.createdAt.seconds * 1000 : 0);
      return tb - ta;
    });
  }

  document.getElementById('dbCount').textContent = list.length + ' 件';
  var container = document.getElementById('dbList');

  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div>条件に一致する食材はありません</div>';
    return;
  }
  container.innerHTML = '';
  list.forEach(function(food) { container.appendChild(buildFoodItem(food)); });
}


/* ====================================
   初期賞味期限設定のラベルテキストを返す
   ==================================== */
function defaultExpiryLabel(food) {
  var type = food.defaultExpiryType || 'ask';
  if (type === 'none') return '期限なし';
  if (type === 'days') {
    var d = food.defaultExpiryDays;
    return d ? d + '日後' : '○日後';
  }
  return '毎回入力';
}


/* ====================================
   食材アイテム DOM 生成
   ==================================== */
function buildFoodItem(food) {
  var wrap = document.createElement('div');
  var inv  = inventoryMap[food.id] || null;

  if (editingId === food.id) {
    /* ── 編集モード ── */
    var curType = food.defaultExpiryType || 'ask';
    var curDays = food.defaultExpiryDays || '';

    wrap.innerHTML =
      '<div class="list-item list-item--editing">' +

        /* 名前行 */
        '<div class="edit-full-row">' +
          '<div class="edit-row-top">' +
            '<input class="edit-input-name" id="en-' + food.id + '" value="' + escapeHtml(food.name) + '" maxlength="40" placeholder="食材名">' +
            '<button class="icon-btn ' + (food.favorite ? 'fav-on' : 'fav-off') + '" id="ef-' + food.id + '" data-fav="' + food.favorite + '">' +
              (food.favorite ? '⭐' : '☆') +
            '</button>' +
          '</div>' +

          /* 初期賞味期限設定 */
          '<div class="edit-default-expiry">' +
            '<span class="edit-default-expiry-label">📅 初期賞味期限</span>' +
            '<div class="edit-def-exp-btns" id="edb-' + food.id + '">' +
              '<button class="def-exp-btn' + (curType === 'ask'  ? ' active' : '') + '" data-type="ask">毎回入力</button>' +
              '<button class="def-exp-btn' + (curType === 'days' ? ' active' : '') + '" data-type="days">○日後</button>' +
              '<button class="def-exp-btn' + (curType === 'none' ? ' active' : '') + '" data-type="none">期限なし</button>' +
            '</div>' +
            '<div class="edit-def-exp-days" id="edd-' + food.id + '" style="display:' + (curType === 'days' ? 'flex' : 'none') + ';">' +
              '<input type="number" class="default-expiry-days-input" id="eddi-' + food.id + '" min="1" max="365" placeholder="日数" value="' + curDays + '">' +
              '<span class="default-expiry-days-unit">日後</span>' +
            '</div>' +
          '</div>' +

          /* 操作ボタン */
          '<div class="edit-action-row">' +
            '<button class="icon-btn save" id="es-' + food.id + '">💾 保存</button>' +
            '<button class="icon-btn" style="background:var(--surface-2);color:var(--text-2)" id="ec-' + food.id + '">✕ キャンセル</button>' +
          '</div>' +
        '</div>' +

      '</div>';

    /* お気に入りトグル */
    var favBtn = wrap.querySelector('#ef-' + food.id);
    favBtn.addEventListener('click', function() {
      var cur = favBtn.dataset.fav === 'true';
      favBtn.dataset.fav = String(!cur);
      favBtn.textContent = !cur ? '⭐' : '☆';
      favBtn.className = 'icon-btn ' + (!cur ? 'fav-on' : 'fav-off');
    });

    /* 初期賞味期限 type ボタン */
    var daysRow = wrap.querySelector('#edd-' + food.id);
    wrap.querySelectorAll('#edb-' + food.id + ' .def-exp-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        wrap.querySelectorAll('#edb-' + food.id + ' .def-exp-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        daysRow.style.display = btn.dataset.type === 'days' ? 'flex' : 'none';
      });
    });

    /* 保存 */
    wrap.querySelector('#es-' + food.id).addEventListener('click', async function() {
      var newName = wrap.querySelector('#en-' + food.id).value.trim();
      var newFav  = wrap.querySelector('#ef-' + food.id).dataset.fav === 'true';
      if (!newName) { showToast('⚠️ 食材名を入力してください'); return; }

      /* 初期賞味期限の取得 */
      var activeTypeBtn = wrap.querySelector('#edb-' + food.id + ' .def-exp-btn.active');
      var newType = activeTypeBtn ? activeTypeBtn.dataset.type : 'ask';
      var newDays = null;
      if (newType === 'days') {
        var daysVal = parseInt(wrap.querySelector('#eddi-' + food.id).value, 10);
        if (!daysVal || daysVal < 1) { showToast('⚠️ 日数を入力してください'); return; }
        newDays = daysVal;
      }

      try {
        var updateData = {
          name:               newName,
          favorite:           newFav,
          defaultExpiryType:  newType,
          defaultExpiryDays:  newDays
        };
        await db.collection('foods').doc(food.id).update(updateData);
        if (inv) {
          await db.collection('inventory').doc(food.id).set({ foodName: newName }, { merge: true });
        }
        showToast('✅ ' + newName + ' を更新しました');
        editingId = null;
      } catch (e) {
        console.error('更新エラー:', e.code, e.message);
        showToast('❌ 更新失敗（' + (e.code || e.message) + '）');
        editingId = null;
      }
    });

    /* キャンセル */
    wrap.querySelector('#ec-' + food.id).addEventListener('click', function() {
      editingId = null; renderDb();
    });

  } else {
    /* ── 通常表示 ── */
    var si = buildStockInfo(inv);
    var defLabel = defaultExpiryLabel(food);

    wrap.innerHTML =
      '<div class="list-item">' +
        '<div class="list-item-left">' +
          '<div class="list-item-name">' +
            (food.favorite ? '<span>⭐</span>' : '') +
            escapeHtml(food.name) +
            '<span class="stock-badge ' + si.cls + '">' + si.label + '</span>' +
          '</div>' +
          '<div class="list-item-sub">' +
            (si.sub ? escapeHtml(si.sub) + '　' : '') +
            '<span class="default-expiry-chip">📅 ' + defLabel + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="list-item-actions">' +
          '<button class="icon-btn ' + (food.favorite ? 'fav-on' : 'fav-off') + '" data-act="fav">' + (food.favorite ? '⭐' : '☆') + '</button>' +
          '<button class="icon-btn ' + (food.excludeFromMenu ? 'exclude-on' : 'exclude-off') + '" data-act="exclude" title="献立提案から除外">🚫</button>' +
          '<button class="mini-action db-buy-btn">🛒</button>' +
          '<button class="icon-btn edit" data-act="edit" title="編集">✏️</button>' +
          '<button class="icon-btn del"  data-act="del"  title="削除">🗑️</button>' +
        '</div>' +
      '</div>';

    wrap.querySelector('.db-buy-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      addFoodToShopping(food);
    });
    wrap.querySelectorAll('[data-act]').forEach(function(btn) {
      btn.addEventListener('click', function() { handleAction(btn.dataset.act, food, inv); });
    });
  }

  return wrap;
}

function buildStockInfo(inv) {
  if (!inv) return { cls: 'no-stock', label: '在庫なし', sub: '' };
  var d = getDaysUntil(inv.expiryDate);
  if (d < 0)   return { cls: 'expired',   label: '期限切れ', sub: formatDate(inv.expiryDate) + (inv.memo ? '　' + inv.memo : '') };
  if (d === 0) return { cls: 'today-exp', label: '今日まで', sub: formatDate(inv.expiryDate) + (inv.memo ? '　' + inv.memo : '') };
  return { cls: 'in-stock', label: 'あと' + d + '日', sub: formatDate(inv.expiryDate) + (inv.memo ? '　' + inv.memo : '') };
}


/* ====================================
   アクションハンドラー
   ==================================== */
async function handleAction(act, food, inv) {
  if (act === 'fav') {
    try {
      await db.collection('foods').doc(food.id).update({ favorite: !food.favorite });
      showToast(!food.favorite ? '⭐ お気に入りに追加' : '☆ お気に入りを解除');
    } catch (e) { showToast('❌ 更新失敗（' + (e.code || e.message) + '）'); }

  } else if (act === 'exclude') {
    var next = !food.excludeFromMenu;
    try {
      await db.collection('foods').doc(food.id).update({ excludeFromMenu: next });
      food.excludeFromMenu = next;
      showToast(next ? '🚫 献立提案から除外しました' : '🍛 献立提案に含めます');
      renderDb();
    } catch (err) {
      console.error('excludeFromMenu update error:', err);
      showToast('❌ 除外設定を更新できませんでした');
    }

  } else if (act === 'edit') {
    editingId = food.id;
    renderDb();
    setTimeout(function() {
      var el = document.getElementById('en-' + food.id);
      if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 50);

  } else if (act === 'del') {
    var ok = await confirmDialog({
      title:   '食材を削除しますか？',
      sub:     '在庫からも削除します。履歴は残ります。',
      detail:  '<p><span class="dl">食材名</span>' + escapeHtml(food.name) + '</p>',
      okLabel: '削除する'
    });
    if (!ok) return;
    try {
      await db.collection('foods').doc(food.id).delete();
      await db.collection('inventory').doc(food.id).delete().catch(function() {});
      showToast('🗑️ ' + food.name + ' を削除しました');
    } catch (e) { showToast('❌ 削除失敗（' + (e.code || e.message) + '）'); }
  }
}


/* ====================================
   新規食材モーダル
   ==================================== */
var newFoodOverlay = document.getElementById('newFoodOverlay');
var newFoodNameEl  = document.getElementById('newFoodName');
var newFoodFavBtn  = document.getElementById('newFoodFavBtn');
var dupMsgEl       = document.getElementById('dupMsg');

/* モーダルを開く */
document.getElementById('fabBtn').addEventListener('click', function() {
  newFoodNameEl.value   = '';
  newFoodIsFav          = false;
  newDefaultExpiryType  = 'ask';
  newDefaultExpiryDays  = null;
  newFoodFavBtn.textContent = '☆';
  newFoodFavBtn.classList.remove('active');
  dupMsgEl.style.display = 'none';

  /* 初期賞味期限ボタンをリセット */
  document.querySelectorAll('#defaultExpiryBtns .def-exp-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.type === 'ask');
  });
  document.getElementById('defaultExpiryDaysRow').style.display = 'none';
  document.getElementById('defaultExpiryDaysInput').value = '';

  newFoodOverlay.classList.add('show');
  setTimeout(function() { newFoodNameEl.focus(); }, 300);
});

document.getElementById('newFoodClose').addEventListener('click', function() {
  newFoodOverlay.classList.remove('show');
});
newFoodOverlay.addEventListener('click', function(e) {
  if (e.target === newFoodOverlay) newFoodOverlay.classList.remove('show');
});

/* お気に入りトグル */
newFoodFavBtn.addEventListener('click', function() {
  newFoodIsFav = !newFoodIsFav;
  newFoodFavBtn.textContent = newFoodIsFav ? '⭐' : '☆';
  newFoodFavBtn.classList.toggle('active', newFoodIsFav);
});

/* 重複チェック */
newFoodNameEl.addEventListener('input', function() {
  var n = newFoodNameEl.value.trim().toLowerCase();
  var dup = n && allFoods.some(function(f) { return f.name.toLowerCase() === n; });
  dupMsgEl.style.display = dup ? 'block' : 'none';
});

/* 初期賞味期限ボタン（新規モーダル） */
document.querySelectorAll('#defaultExpiryBtns .def-exp-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#defaultExpiryBtns .def-exp-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    newDefaultExpiryType = btn.dataset.type;
    var daysRow = document.getElementById('defaultExpiryDaysRow');
    daysRow.style.display = (newDefaultExpiryType === 'days') ? 'flex' : 'none';
    if (newDefaultExpiryType === 'days') {
      document.getElementById('defaultExpiryDaysInput').focus();
    }
  });
});

/* 登録ボタン */
document.getElementById('newFoodRegisterBtn').addEventListener('click', async function() {
  var name = newFoodNameEl.value.trim();
  if (!name) { showToast('⚠️ 食材名を入力してください'); newFoodNameEl.focus(); return; }
  if (allFoods.some(function(f) { return f.name.toLowerCase() === name.toLowerCase(); })) {
    showToast('⚠️ 同名の食材が既に存在します'); return;
  }

  var isFav   = newFoodIsFav;
  var defType = newDefaultExpiryType;
  var defDays = null;

  if (defType === 'days') {
    var daysVal = parseInt(document.getElementById('defaultExpiryDaysInput').value, 10);
    if (!daysVal || daysVal < 1) { showToast('⚠️ 日数を入力してください'); return; }
    defDays = daysVal;
  }

  var defLabel = defType === 'none' ? '期限なし'
               : defType === 'days' ? defDays + '日後'
               : '毎回入力';

  var ok = await confirmDialog({
    title:   '食材を追加しますか？',
    detail:  '<p><span class="dl">食材名</span>'    + escapeHtml(name) + '</p>' +
             '<p><span class="dl">お気に入り</span>' + (isFav ? '⭐' : 'なし') + '</p>' +
             '<p><span class="dl">初期賞味期限</span>' + defLabel + '</p>',
    okLabel: '追加する'
  });
  if (!ok) return;

  newFoodOverlay.classList.remove('show');

  try {
    await db.collection('foods').add({
      name:               name,
      favorite:           isFav,
      defaultExpiryType:  defType,
      defaultExpiryDays:  defDays,
      createdAt:          new Date()
    });
    showToast('✅ ' + name + ' を追加しました');
  } catch (e) {
    console.error('追加エラー:', e.code, e.message);
    showToast('❌ 追加失敗（' + (e.code || e.message) + '）');
  }
});


/* ====================================
   買い物リストへ追加
   ==================================== */
async function addFoodToShopping(food) {
  try {
    var snap = await db.collection('shoppingItems').get();
    var exists = snap.docs.find(function(d) {
      return (d.data().name || '').trim().toLowerCase() === food.name.trim().toLowerCase();
    });
    if (exists) {
      await db.collection('shoppingItems').doc(exists.id).update({
        checked: false, foodId: food.id, order: Date.now()
      });
      showToast('🛒 ' + food.name + ' を買い物リストへ戻しました');
    } else {
      await db.collection('shoppingItems').add({
        name: food.name, foodId: food.id, category: 'food',
        memo: '', checked: false, order: Date.now(), createdAt: new Date()
      });
      showToast('🛒 ' + food.name + ' を買い物リストへ追加しました');
    }
  } catch (e) {
    console.error('shopping add error:', e);
    showToast('❌ 買い物リスト追加失敗');
  }
}
