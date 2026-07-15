/* ============================================================
   home.js — ホーム・在庫管理
   ============================================================ */


console.log('[index] script start');

var startPage = localStorage.getItem('foodStartPage');

if (
  startPage &&
  !sessionStorage.getItem('redirectedStartPage')
) {
  sessionStorage.setItem('redirectedStartPage', 'true');
  location.href = startPage;
}

/* ============================================================
   index.html — ホームページ スクリプト

   Firestore 操作（このページで直接実行）:
     db.collection('inventory')  読み取り（onSnapshot）
     db.collection('foods')      読み取り（onSnapshot）・追加
     db.collection('inventory').doc(foodId).set()  在庫登録（upsert）
     db.collection('history').add()                 履歴追加
   ============================================================ */

/* ===== 確認ダイアログ初期化 ===== */
initConfirmDialog();

/* ===== 状態変数 ===== */
var inventoryItems  = [];   // 在庫リスト（onSnapshot で更新）
var foodMap         = {};   // { foodId: {id, name, favorite} }（お気に入り参照用）
var invReady        = false;// 在庫の初回ロード完了フラグ

var homeSelectedFood = null;  // トグルパネルで選択中の在庫アイテム
var homeExpiryDate   = null;  // トグルパネルで選択中の期限日

var newFoodIsFav      = false;
var newFoodExpiry     = null;
var newFoodExistingId = null;  // 既存食材を選んだ場合の foodId

//期限登録モーダルちゃん
var homeExpiryOverlay = document.getElementById('homeExpiryOverlay');
var modalHomeSearchEl = document.getElementById('modalHomeSearch');
var modalHomeSuggestList = document.getElementById('modalHomeSuggestList');
var modalSelectedFoodInfo = document.getElementById('modalSelectedFoodInfo');
var modalSelectedFoodName = document.getElementById('modalSelectedFoodName');
var modalHomeManualWrap = document.getElementById('modalHomeManualWrap');
var modalHomeManualDate = document.getElementById('modalHomeManualDate');
var modalHomeMemo = document.getElementById('modalHomeMemo');

var modalSelectedFood = null;
var modalExpiryDate = null;

enhanceDateButtons();


/* ====================================
   Firestore リスナー
   ★ orderBy は使わない → JS でソート → インデックス不要
   ==================================== */

/* 在庫 */
/* 在庫：まず get() で確実に表示 → その後 onSnapshot */
function loadInventorySnap(snap) {
  inventoryItems = snap.docs.map(function(d) {
    return Object.assign({ id: d.id }, d.data());
  });

  inventoryItems.sort(function(a, b) {
    return toDateStr(a.expiryDate).localeCompare(toDateStr(b.expiryDate));
  });

  invReady = true;
  renderHome();
  exportInventoryForMenu();
}

db.collection('inventory').get()
  .then(function(snap) {
    console.log('[inventory get] OK:', snap.size);
    loadInventorySnap(snap);
  })
  .catch(function(e) {
    console.error('[inventory get] NG:', e.code, e.message, e);
    invReady = true;
    inventoryItems = [];
    renderHome();
    showToast('❌ 在庫読み込み失敗: ' + (e.code || e.message));
  });

db.collection('inventory').onSnapshot(
  function(snap) {
    console.log('[inventory snapshot] OK:', snap.size);
    loadInventorySnap(snap);
  },
  function(err) {
    console.error('[inventory snapshot] error:', err.code, err.message);
  }
);
/* 食材マスタ（お気に入りフラグ取得用） */
var allFoods = [];

db.collection('foods').onSnapshot(function(snap) {

  allFoods = snap.docs.map(function(d) {
    return Object.assign({ id: d.id }, d.data());
  });

  foodMap = {};

  allFoods.forEach(function(food) {
    foodMap[food.id] = food;
  });
  
  applyPendingFoodFromShopping();

if (invReady) {
  exportInventoryForMenu();
  renderHome();
}

}, function(err) {
  console.warn('foods onSnapshot error:', err.code);
});


db.collection('inventory').get()
  .then(function(snap) {
    console.log('[inventory get] OK:', snap.size);
    showToast('✅ inventory 読み取りOK: ' + snap.size + '件');
  })
  .catch(function(e) {
    console.error('[inventory get] NG:', e.code, e.message, e);
    showToast('❌ inventory 読み取り失敗: ' + e.code);
  });


setTimeout(function() {
  if (!invReady) {
    invReady = true;
    renderHome();
    showToast('⚠️ Firestoreの初回応答がありません');
    console.warn('inventory onSnapshot did not respond');
  }
}, 5000);



/* ====================================
   ホーム設置用の日付エリア
   ==================================== */
function buildTodayBox() {
  var d = new Date();

  return '<div class="today-box">' +
    '<div class="today-box-date">' +
      '<div class="today-year">' + d.getFullYear() + '年</div>' +
      '<div class="today-date">' + (d.getMonth() + 1) + '月' + d.getDate() + '日</div>' +
    '</div>' +
    '<button class="today-register-btn" id="todayRegisterBtn">＋ 期限登録</button>' +
  '</div>';
}

/* ====================================
   ホーム レンダリング（4セクション）
   ==================================== */
function renderHome() {
  console.log('[renderHome] start');

  var main = document.getElementById('mainContent');

  if (!invReady) {
    main.innerHTML = '<div class="empty-state">Firestore接続中...</div>';
    return;
  }

  try {
    var items = inventoryItems.map(function(inv) {
  var food = foodMap[inv.foodId] || {};
  return Object.assign({}, inv, {
    favorite: !!food.favorite,
    pinned: !!food.pinned,
    excludeFromMenu: !!food.excludeFromMenu
  });
});

var pinnedArr = items.filter(function(i) {
  return i.pinned;
});

var excludedArr = items.filter(function(i) {
  return i.excludeFromMenu && !i.pinned;
});

var visibleItems = items.filter(function(i) {
  return !i.excludeFromMenu && !i.pinned;
});

var noExpiryArr = visibleItems.filter(function(i) {
  return i.noExpiry || !i.expiryDate;
});

var datedItems = visibleItems.filter(function(i) {
  return !i.noExpiry && i.expiryDate;
});
    var expired  = datedItems.filter(function(i) { return getDaysUntil(i.expiryDate) < 0; });
var todayArr = datedItems.filter(function(i) { return getDaysUntil(i.expiryDate) === 0; });
var soon     = datedItems.filter(function(i) {
  var d = getDaysUntil(i.expiryDate);
  return d > 0 && d <= 3;
});
var normal   = datedItems.filter(function(i) { return getDaysUntil(i.expiryDate) > 3; });

    main.innerHTML =
  buildTodayBox() +
  buildSection('pinned', '📌 ピン留め', pinnedArr, '') +
  buildSection('expired', '🚨 期限切れ', expired, '期限切れの食材はありません ✨') +
  buildSection('today', '⏰ 今日まで', todayArr, '今日期限の食材はありません') +
  buildSection('soon', '📅 ３日以内', soon, '3日以内に期限が来る食材はありません') +
  buildSection('normal', '📦 在庫中', normal, '') +
  buildSection('no-expiry', '🥬 期限なし', noExpiryArr, '期限なしの食材はありません') +
  buildSection('excluded', '🧂 献立除外・常備品', excludedArr, '献立除外・常備品はありません');
      
      renderInventoryExportInfo();

    var homeSectionClosedState = {};
    
   main.querySelectorAll('.expiry-section.is-collapsible .section-head')
  .forEach(function(head) {
    head.addEventListener('click', function() {
      var section = head.closest('.expiry-section');
      if (!section) return;

      var status = section.dataset.status;

      section.classList.toggle('is-closed');

      if (status) {
        homeSectionClosedState[status] =
          section.classList.contains('is-closed');
      }
    });
  });
    
    var todayRegisterBtn = document.getElementById('todayRegisterBtn');

if (todayRegisterBtn) {
  todayRegisterBtn.addEventListener('click', function() {
    openHomeExpiryModal();
  });
}
    

       main.querySelectorAll('.food-card[data-invid]').forEach(function(card) {
      card.addEventListener('click', function() {
        var item = inventoryItems.find(function(i) {
          return i.id === card.dataset.invid;
        });
        if (item) {
          selectHomeFood(item);
          openPanel();
        }
      });
    });
    
    main.querySelectorAll('.pin-btn').forEach(function(btn) {
  btn.addEventListener('click', async function(e) {
    e.stopPropagation();

    var foodId = btn.dataset.id;
    var food = foodMap[foodId];

    if (!food) return;

    try {
      await db.collection('foods').doc(foodId).update({
        pinned: !food.pinned
      });

      showToast(food.pinned ? '📍 ピンを外しました' : '📌 ピン留めしました');

    } catch (e) {
      console.error('pin update error:', e);
      showToast('❌ ピン更新に失敗しました');
    }
  });
});
    
    
    main.querySelectorAll('.buy-btn').forEach(function(btn) {

  btn.addEventListener('click', async function(e) {

    e.stopPropagation();

    var invId = btn.dataset.id;

    var item = inventoryItems.find(function(i) {
      return i.id === invId;
    });

    if (!item) return;

    try {

      var snap = await db.collection('shoppingItems').get();

      var exists = snap.docs.find(function(d) {

        var data = d.data();

        return (data.name || '').trim().toLowerCase() ===
          item.foodName.trim().toLowerCase();

      });

      if (exists) {

        await db.collection('shoppingItems')
          .doc(exists.id)
          .update({
            checked: false,
            foodId: item.foodId || item.id,
            order: Date.now()
          });

        showToast(
          '🛒 ' + item.foodName + ' を買い物リストへ戻しました'
        );

      } else {

        await db.collection('shoppingItems').add({
          name: item.foodName,
          foodId: item.foodId || item.id,
          category: 'food',
          memo: '',
          checked: false,
          order: Date.now(),
          createdAt: new Date()
        });

        showToast(
          '🛒 ' + item.foodName + ' を買い物リストに追加しました'
        );

      }

    } catch (e) {

      console.error('買い物追加エラー:', e);

      showToast('❌ 買い物リストに追加できませんでした');

    }

  });

});
    

    main.querySelectorAll('.useup-btn').forEach(function(btn) {

  btn.addEventListener('click', async function(e) {

    e.stopPropagation();

    var invId = btn.dataset.id;

    var inv = inventoryItems.find(function(i) {
      return i.id === invId;
    });

    if (!inv) return;

    var food = foodMap[inv.foodId] || {};

    var item = Object.assign({}, inv, {
      favorite: !!food.favorite,
    });

    var ok = await confirmDialog({
      title: '在庫から消しますか？',
      sub: '食材DBと履歴は残ります',
      detail:
        '<p><span class="dl">食材</span>' +
        escapeHtml(item.foodName) +
        '</p>' +
        '<p><span class="dl">期限</span>' + expiryLabel(item.expiryDate) + '</p>',
      okLabel: '使い切った'
    });

    if (!ok) return;

    try {

      await db.collection('inventory')
        .doc(item.id)
        .delete();

      /* お気に入りは買い物リストへ戻す */
      if (item.favorite) {

        var snap = await db.collection('shoppingItems').get();

        var exists = snap.docs.find(function(d) {

          var data = d.data();

          return (data.name || '').trim().toLowerCase() ===
            item.foodName.trim().toLowerCase();

        });

        if (exists) {

          await db.collection('shoppingItems')
            .doc(exists.id)
            .update({
              checked: false,
              order: Date.now(),
              foodId: item.foodId || item.id
            });

          showToast(
            '🛒 ' + item.foodName + ' を買い物リストへ戻しました'
          );

        } else {

          await db.collection('shoppingItems').add({
            name: item.foodName,
            foodId: item.foodId || item.id,
            category: 'food',
            memo: '',
            checked: false,
            order: Date.now(),
            createdAt: new Date()
          });

          showToast(
            '🛒 ' + item.foodName + ' を買い物リストへ追加しました'
          );
        }
      }

      inventoryItems = inventoryItems.filter(function(i) {
        return i.id !== item.id &&
          i.foodId !== item.foodId;
      });

      renderHome();

      if (!item.favorite) {
        showToast(
          '✅ ' + item.foodName + ' を在庫から消しました'
        );
      }

    } catch (e) {

      console.error('在庫削除エラー:', e);

      showToast('❌ 在庫から消せませんでした');

    }

  });

});

  } catch (e) {
    console.error('[renderHome] crash:', e);
    main.innerHTML =
      '<div class="empty-state">⚠️ 描画エラー: ' +
      escapeHtml(e.message || String(e)) +
      '</div>';
  }
}


var homeSectionClosedState = {
  normal: true,
  'no-expiry': true,
  excluded: true
};

function buildSection(status, label, items, emptyMsg) {
  /* normal セクションは空なら丸ごと非表示 */
  if (status === 'normal' && items.length === 0) return '';
  if (status === 'pinned' && items.length === 0) return '';
  var inner = items.length === 0
    ? '<div class="empty-card">' + emptyMsg + '</div>'
    : items.map(function(i) { return buildFoodCard(i, status); }).join('');
 
  var collapsible =
  status === 'normal' ||
  status === 'no-expiry' ||
  status === 'excluded';

var isClosed =
  collapsible &&
  homeSectionClosedState[status];

return '<section class="expiry-section section-' + status +
  (collapsible ? ' is-collapsible' : '') +
  (isClosed ? ' is-closed' : '') +
  '" data-status="' + status + '">' +
  '<div class="section-head" data-status="' + status + '">' +
    '<span class="badge ' + status + '">' + label + '</span>' +
    '<span class="section-count">' + items.length + '件</span>' +
    (collapsible ? '<span class="section-arrow">▼</span>' : '') +
  '</div>' +
  '<div class="food-grid">' + inner + '</div>' +
  '</section>';
}

function buildFoodCard(item, status) {
  var days  = getDaysUntil(item.expiryDate);
  var label = item.noExpiry || !item.expiryDate
  ? '期限なし'
  : daysLabel(getDaysUntil(item.expiryDate));

var dateText = item.noExpiry || !item.expiryDate
  ? ''
  : formatDate(item.expiryDate);
  
  return '<div class="food-card ' + status + '" data-invid="' + item.id + '">' +
    '<span class="food-card-fav">' + (item.favorite ? '⭐' : '') + '</span>' +
    '<div class="food-card-body">' +
      '<div class="food-card-name">' + escapeHtml(item.foodName) + '</div>' +
      (item.memo ? '<div class="food-card-memo">' + escapeHtml(item.memo) + '</div>' : '') +
    '</div>' +
    '<div class="food-card-right">' +

  '<div class="food-card-top">' +
    '<div class="food-card-date">' + dateText + '</div>' +
    '<span class="days-chip ' + status + '">' + label + '</span>' +
  '</div>' +

  '<div class="food-card-actions">' +
    '<button class="mini-action pin-btn ' + (item.pinned ? 'is-pinned' : '') +
    '" data-id="' + item.foodId + '">' +
      (item.pinned ? '📌' : '📍') +
    '</button>' +
    '<button class="mini-action buy-btn" data-id="' + item.id + '">🛒</button>' +
    '<button class="mini-action useup-btn" data-id="' + item.id + '">使い切った</button>' +
  '</div>' +

'</div>'+
    '</div>';
}


//modal
function openHomeExpiryModal() {
  document.body.classList.add('modal-open');

  modalSelectedFood = null;
  modalExpiryDate = null;

  modalHomeSearchEl.value = '';
  modalHomeSuggestList.innerHTML = '';
  modalHomeSuggestList.classList.remove('show');
  modalSelectedFoodInfo.style.display = 'none';

  modalHomeManualDate.value = '';
  modalHomeManualWrap.classList.remove('show');
  modalHomeMemo.value = '';

  document.querySelectorAll('#modalHomeDateBtns .date-btn').forEach(function(b) {
    b.classList.remove('active');
  });

  homeExpiryOverlay.classList.add('show');

  setTimeout(function() {
    modalHomeSearchEl.focus();
  }, 100);
}

function closeHomeExpiryModal() {
  document.body.classList.remove('modal-open');
  
  homeExpiryOverlay.classList.remove('show');
}

//モーダル閉じる
document.getElementById('modalHomeCancel').addEventListener('click', function() {
  closeHomeExpiryModal();
});

modalHomeSuggestList.addEventListener('click', function(e) {
  e.stopPropagation();
});

modalHomeSuggestList.addEventListener('touchstart', function(e) {
  e.stopPropagation();
});

//モーダルサジェスト
function selectModalHomeFood(item) {
  var foodId = item.foodId || item.id;
  var foodName = item.foodName || item.name;
  var master = foodMap[foodId] || item;

  modalSelectedFood = {
    foodId: foodId,
    foodName: foodName,
    favorite: !!master.favorite,
    isNew: !!item.isNew
  };

  modalHomeSearchEl.value = foodName;
  modalSelectedFoodName.textContent = foodName;
  modalSelectedFoodInfo.style.display = 'block';
  modalHomeSuggestList.classList.remove('show');

  /* ★ 初期賞味期限設定をモーダル日付ボタンに反映 */
  applyDefaultExpiryToModal(master);
}

/**
 * foods マスタの defaultExpiryType/Days を
 * 期限登録モーダルの日付ボタン・modalExpiryDate に反映する
 */
function applyDefaultExpiryToModal(food) {
  var type = food.defaultExpiryType || 'ask';
  var days = food.defaultExpiryDays || null;

  document.querySelectorAll('#modalHomeDateBtns .date-btn').forEach(function(b) {
    b.classList.remove('active');
  });
  modalHomeManualWrap.classList.remove('show');
  modalExpiryDate = null;

  if (type === 'none') {
    var noneBtn = document.querySelector('#modalHomeDateBtns .date-btn[data-days="none"]');
    if (noneBtn) {
      noneBtn.classList.add('active');
      modalExpiryDate = 'none';
    }
  } else if (type === 'days' && days) {
    var dateStr = getDateStr(days);
    var matched = false;
    document.querySelectorAll('#modalHomeDateBtns .date-btn').forEach(function(b) {
      if (b.dataset.days && b.dataset.days !== 'none' && b.dataset.days !== 'manual') {
        if (Number(b.dataset.days) === days) {
          b.classList.add('active');
          modalExpiryDate = dateStr;
          matched = true;
        }
      }
    });
    if (!matched) {
      var manualBtn = document.querySelector('#modalHomeDateBtns .date-btn[data-days="manual"]');
      if (manualBtn) manualBtn.classList.add('active');
      modalHomeManualWrap.classList.add('show');
      modalHomeManualDate.value = dateStr;
      modalExpiryDate = dateStr;
    }
  }
}


//モーダルinput用イベント
var modalHomeSearchTimer;

modalHomeSearchEl.addEventListener('input', function() {
  clearTimeout(modalHomeSearchTimer);

  modalHomeSearchTimer = setTimeout(function() {
    modalSelectedFood = null;
    modalSelectedFoodInfo.style.display = 'none';

    var keyword = modalHomeSearchEl.value.trim();
    var foodList = Object.values(foodMap);
    var candidates = suggestSort(keyword, foodList, 'name', 8);

    modalHomeSuggestList.innerHTML = '';

    if (!keyword) {
      modalHomeSuggestList.classList.remove('show');
      return;
    }
    
    //候補になければ新規追加
    if (!candidates.length) {

  var div = document.createElement('div');

  div.className =
    'suggest-item suggest-create';

  div.innerHTML =
    '<span class="suggest-name">＋ 「' +
    escapeHtml(keyword) +
    '」を新規食材として追加</span>';

  div.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();

    modalSelectedFood = {
      isNew: true,
      foodName: keyword,
      favorite: false
    };

    modalHomeSearchEl.value = keyword;

    modalSelectedFoodName.textContent = keyword;

    modalSelectedFoodInfo.style.display = 'block';

    modalHomeSuggestList.classList.remove('show');
  });

  div.addEventListener('mousedown', function(e) {
    e.preventDefault();
    e.stopPropagation();

    modalSelectedFood = {
      isNew: true,
      foodName: keyword,
      favorite: false
    };

    modalHomeSearchEl.value = keyword;

    modalSelectedFoodName.textContent = keyword;

    modalSelectedFoodInfo.style.display = 'block';

    modalHomeSuggestList.classList.remove('show');
  });

  modalHomeSuggestList.innerHTML = '';

  modalHomeSuggestList.appendChild(div);

  modalHomeSuggestList.classList.add('show');

  return;
}
    

    candidates.forEach(function(food) {
      var div = document.createElement('div');
      div.className = 'suggest-item';
      div.innerHTML =
        '<span class="suggest-fav">' + (food.favorite ? '⭐' : '') + '</span>' +
        '<span class="suggest-name">' + escapeHtml(food.name) + '</span>' +
        '<span class="suggest-badge">食材DB</span>';

div.addEventListener('click', function(e) {
  e.preventDefault();
  e.stopPropagation();
  selectModalHomeFood(food);
});


      div.addEventListener('mousedown', function(e) {
        e.preventDefault();
        selectModalHomeFood(food);
      });

      modalHomeSuggestList.appendChild(div);
    });

    modalHomeSuggestList.classList.toggle('show', candidates.length > 0);
  }, 150);
});

//モーダル日付ボタン処理
document.querySelectorAll('#modalHomeDateBtns .date-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#modalHomeDateBtns .date-btn').forEach(function(b) {
      b.classList.remove('active');
    });

    btn.classList.add('active');

    if (btn.dataset.days === 'none') {
      modalHomeManualWrap.classList.remove('show');
      modalExpiryDate = 'none';
    } else if (btn.dataset.days === 'manual') {
      modalHomeManualWrap.classList.add('show');
      openDatePicker(modalHomeManualDate);
      modalExpiryDate = modalHomeManualDate.value || null;
    } else {
      modalHomeManualWrap.classList.remove('show');
      modalExpiryDate = getDateStr(Number(btn.dataset.days));
    }
  });
});

modalHomeManualDate.addEventListener('change', function() {
  modalExpiryDate = modalHomeManualDate.value || null;
});

//モーダル登録ボタン処理
document.getElementById('modalHomeOk').addEventListener('click', async function() {
  if (!modalSelectedFood) {
    var keyword = modalHomeSearchEl.value.trim();

    var matchedFood = Object.values(foodMap).find(function(food) {
      return food.name.trim().toLowerCase() === keyword.toLowerCase();
    });

    if (matchedFood) {
      selectModalHomeFood(matchedFood);
    }
  }

  if (!modalSelectedFood) {
    showToast('⚠️ 食材を選択してください');
    modalHomeSearchEl.focus();
    return;
  }

  if (!modalExpiryDate) {
    showToast('⚠️ 期限日を選択してください');
    return;
  }

  var food = modalSelectedFood;
  var date = modalExpiryDate;
  var memo = modalHomeMemo.value.trim();
  var noExpiry = date === 'none';

  try {
    var docId;

    if (food.isNew) {
      var ref = await db.collection('foods').add({
        name: food.foodName,
        favorite: false,
        createdAt: new Date()
      });

      docId = ref.id;
    } else {
      docId = food.foodId || food.id;
    }

    await db.collection('inventory').doc(docId).set({
      foodId: docId,
      foodName: food.foodName,
      expiryDate: noExpiry ? '' : date,
      noExpiry: noExpiry,
      memo: memo,
      updatedAt: new Date()
    });

    await db.collection('history').add({
      foodId: docId,
      foodName: food.foodName,
      expiryDate: noExpiry ? '' : date,
      noExpiry: noExpiry,
      memo: memo,
      favorite: !!(foodMap[docId] && foodMap[docId].favorite),
      registeredAt: new Date()
    });

    showToast('✅ ' + food.foodName + ' の期限を登録しました');
    closeHomeExpiryModal();

  } catch (e) {
    console.error('modal home expiry error:', e);
    showToast('❌ 登録に失敗しました');
  }
});



/* ====================================
   トグルパネル
   ==================================== */
var toggleBtn  = document.getElementById('toggleBtn');
var inputPanel = document.getElementById('inputPanel');
var fabBtn     = document.getElementById('fabBtn');

function openPanel() {
  inputPanel.classList.add('open');
  toggleBtn.classList.add('open');
  fabBtn.classList.add('hidden');
  document.getElementById('homeSearch').focus();
}
function closePanel() {
  inputPanel.classList.remove('open');
  toggleBtn.classList.remove('open');
  fabBtn.classList.remove('hidden');
}
toggleBtn.addEventListener('click', function() {
  inputPanel.classList.contains('open') ? closePanel() : openPanel();
});


/* ====================================
   トグルパネル：検索サジェスト
   ==================================== */
var homeSearchEl    = document.getElementById('homeSearch');
var homeSuggestList = document.getElementById('homeSuggestList');
var selFoodInfo     = document.getElementById('selectedFoodInfo');
var selFoodName     = document.getElementById('selectedFoodName');


function applyPendingFoodFromShopping() {
  var pendingFoodId = sessionStorage.getItem('pendingFoodId');
  var pendingFoodName = sessionStorage.getItem('pendingFoodName');

  if (!pendingFoodId && !pendingFoodName) return;

  var food = null;

  if (pendingFoodId && foodMap[pendingFoodId]) {
    food = foodMap[pendingFoodId];
  } else if (pendingFoodName) {
    food = Object.values(foodMap).find(function(f) {
      return f.name === pendingFoodName;
    });
  }

  if (!food) return;

  sessionStorage.removeItem('pendingFoodId');
  sessionStorage.removeItem('pendingFoodName');

  openPanel();
  selectHomeFood(food);

  showToast('📅 期限を選んで登録してください');
}


function selectHomeFood(item) {
  var foodId = item.foodId || item.id;
  var foodName = item.foodName || item.name;
  var master = foodMap[foodId] || item;

  if (!foodId || !foodName) {
    showToast('❌ 食材データが壊れています');
    return;
  }

  homeSelectedFood = {
    foodId: foodId,
    foodName: foodName,
    favorite: !!master.favorite,
    isNew: !!item.isNew
  };

  homeSearchEl.value = foodName;
  selFoodName.textContent = foodName;
  selFoodInfo.style.display = 'block';
  homeSuggestList.classList.remove('show');

  /* ★ 初期賞味期限設定を日付ボタンに反映 */
  applyDefaultExpiry(master);
}

/**
 * foods マスタの defaultExpiryType/Days を
 * トグルパネルの日付ボタン・homeExpiryDate に反映する
 */
function applyDefaultExpiry(food) {
  var type = food.defaultExpiryType || 'ask';
  var days = food.defaultExpiryDays || null;

  /* ボタンを全リセット */
  document.querySelectorAll('#homeDateBtns .date-btn').forEach(function(b) {
    b.classList.remove('active');
  });
  homeManualWrap.classList.remove('show');
  homeExpiryDate = null;

  if (type === 'none') {
    /* 期限なし → "期限なし" ボタンをアクティブ */
    var noneBtn = document.querySelector('#homeDateBtns .date-btn[data-days="none"]');
    if (noneBtn) {
      noneBtn.classList.add('active');
      homeExpiryDate = 'none';
    }
  } else if (type === 'days' && days) {
    /* ○日後 → 一致するボタンがあればアクティブ、なければ手動入力欄に日付をセット */
    var dateStr = getDateStr(days);
    var matched = false;
    document.querySelectorAll('#homeDateBtns .date-btn').forEach(function(b) {
      if (b.dataset.days && b.dataset.days !== 'none' && b.dataset.days !== 'manual') {
        if (Number(b.dataset.days) === days) {
          b.classList.add('active');
          homeExpiryDate = dateStr;
          matched = true;
        }
      }
    });
    if (!matched) {
      /* ボタンに一致する日数がなければ手動入力欄に自動セット */
      var manualBtn = document.querySelector('#homeDateBtns .date-btn[data-days="manual"]');
      if (manualBtn) manualBtn.classList.add('active');
      homeManualWrap.classList.add('show');
      homeManualDate.value = dateStr;
      homeExpiryDate = dateStr;
    }
  }
  /* type === 'ask' は何もしない（毎回入力） */
}

var homeSearchTimer;

homeSearchEl.addEventListener('input', function() {
  clearTimeout(homeSearchTimer);

  homeSearchTimer = setTimeout(function() {

    homeSelectedFood = null;
    selFoodInfo.style.display = 'none';

    var foodList = Object.values(foodMap);

    var candidates = suggestSort(
      homeSearchEl.value,
      foodList,
      'name',
      8
    );

    homeSuggestList.innerHTML = '';

    var keyword = homeSearchEl.value.trim();

if (!keyword) {
  homeSuggestList.classList.remove('show');
  return;
}

if (!candidates.length) {

  var div = document.createElement('div');

  div.className =
    'suggest-item suggest-create';

  div.innerHTML =
    '<span class="suggest-name">＋ 「' +
    escapeHtml(keyword) +
    '」を新規食材として追加</span>';

  div.addEventListener('mousedown', function(e) {

    e.preventDefault();

    homeSelectedFood = {
      isNew: true,
      foodName: keyword,
      favorite: false
    };

    homeSearchEl.value = keyword;

    selFoodName.textContent = keyword;

    selFoodInfo.style.display = 'block';

    homeSuggestList.classList.remove('show');

  });

  homeSuggestList.innerHTML = '';

  homeSuggestList.appendChild(div);

  homeSuggestList.classList.add('show');

  return;
}

    candidates.forEach(function(food) {

      var div = document.createElement('div');

      div.className = 'suggest-item';

      div.innerHTML =
        '<span class="suggest-fav">' +
          (food.favorite ? '⭐' : '') +
        '</span>' +

        '<span class="suggest-name">' +
          escapeHtml(food.name) +
        '</span>' +

        '<span class="suggest-badge">食材DB</span>';

      div.addEventListener('mousedown', function(e) {
        e.preventDefault();
        selectHomeFood(food);
      });

      homeSuggestList.appendChild(div);

    });

    homeSuggestList.classList.add('show');

  }, 150);
});

homeSearchEl.addEventListener('blur', function() {
  setTimeout(function() {
    homeSuggestList.classList.remove('show');
  }, 200);
});

/* ====================================
   トグルパネル：日数テンプレート
   ==================================== */
var homeManualWrap = document.getElementById('homeManualWrap');
var homeManualDate = document.getElementById('homeManualDate');

document.querySelectorAll('#homeDateBtns .date-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#homeDateBtns .date-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    if (btn.dataset.days === 'none') {
  homeManualWrap.classList.remove('show');
  homeExpiryDate = 'none';
} else if (btn.dataset.days === 'manual') {
  homeManualWrap.classList.add('show');

  openDatePicker(homeManualDate);

  homeExpiryDate = homeManualDate.value || null;
} else {
  homeManualWrap.classList.remove('show');
  homeExpiryDate = getDateStr(Number(btn.dataset.days));
}
  });
});
homeManualDate.addEventListener('change', function() {
  homeExpiryDate = homeManualDate.value || null;
});


/* ====================================
   トグルパネル：期限登録
   ==================================== */
document.getElementById('homeRegisterBtn').addEventListener('click', async function() {

 /*完全一致は選択しなくてOKなやつ*/
   if (!homeSelectedFood) {
  var keyword = homeSearchEl.value.trim();

  var matchedFood = Object.values(foodMap).find(function(food) {
    return food.name.trim().toLowerCase() === keyword.toLowerCase();
  });

  if (matchedFood) {
    selectHomeFood(matchedFood);
  }
}
   


  if (!homeSelectedFood) {
    showToast('⚠️ 食材を選択してください');
    homeSearchEl.focus();
    return;
  }
  if (!homeExpiryDate) {
    showToast('⚠️ 期限日を選択してください');
    return;
  }
  
     
  var food = homeSelectedFood;

console.log('[register] homeSelectedFood:', food);

if (
  !food ||
  !food.foodName ||
  (!food.isNew && !food.foodId)
) {
  showToast('❌ データが壊れています');
  console.warn('[register] invalid selected food:', food);
  return;
}

  var food  = homeSelectedFood;
  var date  = homeExpiryDate;
  var memo  = document.getElementById('homeMemo').value.trim();

  var ok = await confirmDialog({
    title:   '期限を登録しますか？',
    detail:  '<p><span class="dl">食材</span>' + escapeHtml(food.foodName) + '</p>' +
             '<p><span class="dl">期限</span>' + expiryLabel(date) + '</p>' +
             (memo ? '<p><span class="dl">メモ</span>' + escapeHtml(memo) + '</p>' : ''),
    okLabel: '登録する'
  });
  if (!ok) return;

  try {
    /* ★ inventory のドキュメントIDは foodId 固定（upsert） */
    
    var docId;

if (food.isNew) {
  var ref = await db.collection('foods').add({
    name: food.foodName,
    favorite: false,
    createdAt: new Date()
  });

  docId = ref.id;
} else {
  docId = food.foodId || food.id;
}
    
    
    
    var noExpiry = date === 'none';

await db.collection('inventory').doc(docId).set({
  foodId: docId,
  foodName: food.foodName,
  expiryDate: noExpiry ? '' : date,
  noExpiry: noExpiry,
  memo: memo,
  updatedAt: new Date()
});
    /* 履歴を追加 */
    await db.collection('history').add({
  foodId: docId,
  foodName: food.foodName,
  favorite: !!(foodMap[docId] && foodMap[docId].favorite),
  expiryDate: noExpiry ? '' : date,
  noExpiry: noExpiry,
  memo: memo,
  registeredAt: new Date()
});
    showToast('✅ ' + food.foodName + ' の期限を登録しました');
    resetPanel();
    closePanel();
  } catch (e) {
    console.error('期限登録エラー:', e.code, e.message, e);
    showToast('❌ 登録に失敗しました（' + (e.code || e.message) + '）');
  }
});

function resetPanel() {
  homeSearchEl.value = '';
  homeSelectedFood   = null;
  homeExpiryDate     = null;
  selFoodInfo.style.display = 'none';
  document.getElementById('homeMemo').value = '';
  homeManualDate.value = '';
  homeManualWrap.classList.remove('show');
  document.querySelectorAll('#homeDateBtns .date-btn').forEach(function(b) { b.classList.remove('active'); });
}


/* ====================================
   新規食材追加モーダル
   ==================================== */
var newFoodOverlay    = document.getElementById('newFoodOverlay');
var newFoodNameEl     = document.getElementById('newFoodName');
var newFoodSuggestEl  = document.getElementById('newFoodSuggestList');
var newFoodManualWrap = document.getElementById('newFoodManualWrap');
var newFoodManualDate = document.getElementById('newFoodManualDate');
var newFoodFavBtn     = document.getElementById('newFoodFavBtn');

function openNewFoodModal() {
  /* 状態リセット */
  newFoodNameEl.value   = '';
  newFoodIsFav          = false;
  newFoodExpiry         = null;
  newFoodExistingId     = null;
  newFoodFavBtn.textContent = '☆';
  newFoodFavBtn.classList.remove('active');
  newFoodManualDate.value = '';
  newFoodManualWrap.classList.remove('show');
  newFoodSuggestEl.innerHTML = '';
  newFoodSuggestEl.classList.remove('show');
  document.getElementById('newFoodMemo').value = '';
  document.querySelectorAll('#newFoodDateBtns .date-btn').forEach(function(b) { b.classList.remove('active'); });

  newFoodOverlay.classList.add('show');
  
}
function closeNewFoodModal() {
  newFoodOverlay.classList.remove('show');
}

fabBtn.addEventListener('click', openNewFoodModal);
document.getElementById('newFoodClose').addEventListener('click', closeNewFoodModal);
newFoodOverlay.addEventListener('click', function(e) {
  if (e.target === newFoodOverlay) closeNewFoodModal();
});

/* お気に入りトグル */
newFoodFavBtn.addEventListener('click', function() {
  newFoodIsFav = !newFoodIsFav;
  newFoodFavBtn.textContent = newFoodIsFav ? '⭐' : '☆';
  newFoodFavBtn.classList.toggle('active', newFoodIsFav);
});

/* 食材名サジェスト（foods コレクションから） */
var nfSearchTimer;
newFoodNameEl.addEventListener('input', function() {
  clearTimeout(nfSearchTimer);
  newFoodExistingId = null;
  nfSearchTimer = setTimeout(function() {
    var foodList = Object.values(foodMap);
    var candidates = suggestSort(newFoodNameEl.value, foodList, 'name', 8);
    newFoodSuggestEl.innerHTML = '';
    if (!candidates.length || !newFoodNameEl.value.trim()) {
      newFoodSuggestEl.classList.remove('show');
      return;
    }
    candidates.forEach(function(food) {
      var div = document.createElement('div');
      div.className = 'suggest-item';
      div.innerHTML =
        '<span class="suggest-fav">' + (food.favorite ? '⭐' : '') + '</span>' +
        '<span class="suggest-name">' + escapeHtml(food.name) + '</span>' +
        '<span class="suggest-badge">既存</span>';
      div.addEventListener('mousedown', function(e) {
        e.preventDefault();
        newFoodNameEl.value   = food.name;
        newFoodIsFav          = !!food.favorite;
        newFoodExistingId     = food.id;
        newFoodFavBtn.textContent = newFoodIsFav ? '⭐' : '☆';
        newFoodFavBtn.classList.toggle('active', newFoodIsFav);
        newFoodSuggestEl.classList.remove('show');
      });
      newFoodSuggestEl.appendChild(div);
    });
    newFoodSuggestEl.classList.add('show');
  }, 150);
});
newFoodNameEl.addEventListener('blur', function() {
  setTimeout(function() { newFoodSuggestEl.classList.remove('show'); }, 200);
});

/* 日数テンプレート */
document.querySelectorAll('#newFoodDateBtns .date-btn').forEach(function(btn) {

  btn.addEventListener('click', function() {

    document.querySelectorAll('#newFoodDateBtns .date-btn')
      .forEach(function(b) {
        b.classList.remove('active');
      });

    btn.classList.add('active');

    if (btn.dataset.days === 'none') {

      newFoodManualWrap.classList.remove('show');

      newFoodExpiry = 'none';

    } else if (btn.dataset.days === 'manual') {

  newFoodManualWrap.classList.add('show');

      setTimeout(function() {

        newFoodManualDate.showPicker?.();

        newFoodManualDate.focus();

        newFoodManualDate.click();

      }, 50);

      newFoodExpiry =
        newFoodManualDate.value || null;

    } else {

      newFoodManualWrap.classList.remove('show');

      newFoodExpiry =
        getDateStr(Number(btn.dataset.days));

    }

  });

});


newFoodManualDate.addEventListener('change', function() {
  newFoodExpiry = newFoodManualDate.value || null;
});

/* 新規食材 登録ボタン */
document.getElementById('newFoodRegisterBtn').addEventListener('click', async function() {
  var name  = newFoodNameEl.value.trim();
  if (!name) { showToast('⚠️ 食材名を入力してください'); newFoodNameEl.focus(); return; }
  if (!newFoodExpiry) { showToast('⚠️ 期限日を選択してください'); return; }

  var memo    = document.getElementById('newFoodMemo').value.trim();
  var isFav   = newFoodIsFav;
  var expiry  = newFoodExpiry;
  var existId = newFoodExistingId;
  var noExpiry = expiry === 'none';

  var ok = await confirmDialog({
    title:   existId ? '期限を登録しますか？' : '新規食材を追加しますか？',
    sub:     existId ? '既存食材の在庫を更新します' : '食材DBに追加して在庫に登録します',
    detail:  '<p><span class="dl">食材名</span>' + escapeHtml(name) + '</p>' +
             '<p><span class="dl">期限</span>' + expiryLabel(expiry) + '</p>' +
             '<p><span class="dl">お気に入り</span>' + (isFav ? '⭐' : 'なし') + '</p>' +
             (memo ? '<p><span class="dl">メモ</span>' + escapeHtml(memo) + '</p>' : ''),
    okLabel: existId ? '登録する' : '追加する'
  });
  if (!ok) return;

  /* ★ 確認OK → 即モーダルを閉じる */
  closeNewFoodModal();

  try {
    var foodId = existId;

    if (!foodId) {
      /* 新規食材をDBに追加 */
      var ref = await db.collection('foods').add({
        name:      name,
        favorite:  isFav,
        createdAt: new Date()
      });
      foodId = ref.id;
    } else {
      /* 既存食材のお気に入りを更新 */
      await db.collection('foods').doc(foodId).update({ favorite: isFav });
    }

    /* 在庫を登録（doc ID = foodId で upsert） */
    await db.collection('inventory').doc(foodId).set({
      foodId:     foodId,
      foodName:   name,
      expiryDate: noExpiry ? '' : expiry,
      noExpiry:   noExpiry,
      memo:       memo,
      updatedAt:  new Date()
    });

    /* 履歴を追加 */
    await db.collection('history').add({
  foodId: foodId,
  foodName: name,
  expiryDate: noExpiry ? '' : expiry,
  noExpiry: noExpiry,
  memo: memo,
  favorite: !!isFav,
  registeredAt: new Date()
});

    showToast('✅ ' + name + ' を追加しました');
  } catch (e) {
    console.error('新規食材追加エラー:', e.code, e.message, e);
    showToast('❌ 追加に失敗しました（' + (e.code || e.message) + '）');
  }
});




//在庫の食材データを渡すやつ
function exportInventoryForMenu() {
  var names = inventoryItems
    .filter(function(item) {
      var food = foodMap[item.foodId];

      return !(food && food.excludeFromMenu);
    })
    .map(function(item) {
      return item.foodName;
    })
    .filter(Boolean);

  var uniqueNames = Array.from(new Set(names));
  //在庫リストの50音順ソート
  uniqueNames.sort(function(a, b) {
  return a.localeCompare(b, 'ja');
});

  localStorage.setItem(
    'foodInventoryForMenu',
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      ingredients: uniqueNames
    })
  );
  renderInventoryExportInfo();
}

//==============================
// 在庫の手動更新
//==============================
function renderInventoryExportInfo() {
  var el = document.getElementById('inventoryExportInfo');
  if (!el) return;

  var raw = localStorage.getItem('foodInventoryForMenu');

  if (!raw) {
    el.textContent = '最終送信：未送信';
    return;
  }

  try {
    var data = JSON.parse(raw);

    if (!data.updatedAt) {
      el.textContent = '最終送信：不明';
      return;
    }

    el.textContent =
      '最終送信：' +
      new Date(data.updatedAt).toLocaleString('ja-JP');

  } catch(e) {
    el.textContent = '最終送信：不明';
  }
}

function manualExportInventory() {
  exportInventoryForMenu();
  renderInventoryExportInfo();
  showToast('🍛 献立アプリ用の在庫一覧を送信しました');
}