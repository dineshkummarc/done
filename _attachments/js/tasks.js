/*jshint */

window.log = function(){
  log.history = log.history || [];
  log.history.push(arguments);
  if(this.console){
    console.log( Array.prototype.slice.call(arguments) );
  }
};

$.ajaxSetup({
  cache: false
});




var Tasks = (function () {

  // This is the list of predefined tag colours, if there are more tags
  // than colours then tags turn black
  var tagColors = [
    '#288BC2', '#DB2927', '#17B546', '#EB563E', '#AF546A', '#4A4298',
    '#E7CD17', '#651890', '#E1B931', '#978780', '#CC7E5B', '#7C3F09',
    '#978780', '#07082F'
  ];

  var taskEstimates = [
    {value: 10, text: '10 Minutes'},
    {value: 30, text: '30 Minutes'},
    {value: 60, text: '1 Hour'},
    {value: 120, text: '2 Hours'},
    {value: 240, text: '4 Hours'}
  ];

  var days = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];

  var months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  var dbName = document.location.pathname.split('/')[1];
  var $db = $.couch.db(dbName);
  var $changes;

  var router = Router();

  var paneWidth = 0;
  var current_tpl = null;
  var currentOffset = 0;
  var lastPane = null;
  var myChanges = [];
  var currentLimit = 20;


  router.get('#/?', function (_, t) {
    $(window).bind('scroll', infiniteScroll);
    router.forward('#/tags/');
  }).unload(function() {
    $(window).unbind('scroll', infiniteScroll);
  });


  router.get('#/task/:id/', function (_, id) {
    getTags(function(tags) {

      $db.openDoc(id).then(function(doc) {

        doc.tags = $.each(tags, function(_, obj) {
          obj.active = !($.inArray(obj.tag, doc.tags) === -1);
        });

        doc.estimates = $.each($.extend(true, [], taskEstimates), function(_, obj) {
          if (obj.value === (doc.estimate || 60)) {
            obj.selected = true;
          }
        });

        render('task_tpl', null, doc, function(dom) {
          $('.tag_wrapper', dom).bind('click', function(e) {
            if ($(e.target).is("a.tag")) {
              $(e.target).toggleClass('active');
            }
          });
        });
      });
    });
  });


  router.get('#/tags/*test', function (_, t) {
    render('home_tpl', '#home_content', {}, function(dom) {
      $('#filter_tags', dom).bind('click', function(e) {
        if ($(e.target).is("a.tag")) {
          updateFilterUrl($(e.target).data('key'));
        }
      });
    }).then(function() {
      updateTaskList();
    });
  });


  router.post('#edit', function (_, e, details) {

    $db.openDoc(details.id).then(function(doc) {

      var tags = [];
      var parsedTags = extractHashTags(details.title);

      $('.tag_wrapper .tag.active').each(function() {
        tags.push($(this).attr('data-key'));
      });

      doc.estimate = parseInt(details.estimate, 10);
      doc.tags = tags.concat(parsedTags.tags);
      doc.title = parsedTags.text;
      doc.notes = details.notes;
      doc.check = details.completed && details.completed === 'on';

      $db.saveDoc(doc).then(function() {
        router.back();
      });

    });
  });


  router.post('#add_task', function (_, e, details) {

    var doc = extractHashTags(details.title);
    var top = $('#tasks_wrapper li:not(.date)').first();
    var index = top.data('index') + 1 || 1;

    if(doc.text === '') {
      return;
    }

    $db.saveDoc({
      type: 'task',
      index: index,
      check: false,
      title: doc.text,
      tags: doc.tags,
      notes: ''
    }).then(function (data) {
      $('#add_task_input').val('');
    });

  });


  function infiniteScroll() {
    if ($(window).scrollTop() == $(document).height() - $(window).height()){
      currentLimit += 20;
      $("#infinite_load").show();
      updateTaskList();
    }
  };


  function markDone(e) {

    var status = $(this).is(':checked') ? true : false;
    var li = $(e.target).parents("li");
    var id = li.attr("data-id");
    var url = '/' + dbName + '/_design/couchtasks/_update/update_status/' + id +
      '?status=' + status;

    myChanges.push(id);

    $.ajax({
      url: url,
      type: 'PUT',
      contentType:'application/json',
      datatype: 'json'
    }).then(function() {
      if (current_tpl !== 'home_tpl') {
        if (status) {
          li.addClass('deleted');
        } else {
          li.removeClass('deleted');
        }
      } else {
        var ul = li.parent("ul");
        if (status) {
          li.detach();
            li.addClass('deleted');
          li.appendTo(ul);
        } else {
          li.detach();
          li.removeClass('deleted');
          var index = li.data("index");
          var obj;
          ul.children().each(function(_, child) {
            if ($(child).data("index") < index) {
              obj = child;
              return false;
            }
          });
          if (!obj) {
            li.appendTo(ul);
          } else {
            li.insertBefore(obj || ul);
          }
        }
      }
    });
  }


  function updateIndex(id, index) {
    var url = '/' + dbName + '/_design/couchtasks/_update/update_index/' + id +
      '?index=' + index;
    $.ajax({
      url: url,
      type: 'PUT',
      contentType: 'application/json',
      datatype: 'json'
    });
  }


  function render(tpl, dom, data, init) {

    var dfd = $.Deferred();
    data = data || {};
    $('body').removeClass(current_tpl).addClass(tpl);

    var rendered = Mustache.to_html($("#" + tpl).html(), data),
    $pane = $('<div class="pane"><div class="content">' + rendered + '</div></div>');
    createCheckBox($pane);

    if (init) {
      init($pane);
    }

    var transition = 'slideHorizontal';

    if (current_tpl) {
      currentOffset += (calcIndex(tpl, current_tpl)) ? paneWidth : -paneWidth;
    }

    var tmp = lastPane;
    $('#content').one('webkitTransitionEnd transitionend', function() {
      if (tmp) {
        tmp.remove();
        tmp = null;
      }
      dfd.resolve();
    });

    transformX($pane, currentOffset);
    $pane.appendTo($('#content'));

    transformX($('#content'), -currentOffset);
    lastPane = $pane;
    current_tpl = tpl;

    return dfd.promise();
  }


  function calcIndex(a, b) {
    var indexii = {home_tpl:1, complete_tpl:2, sync_tpl:3, task_tpl:4};
    return indexii[a] > indexii[b];
  }


  function updateTaskList() {
    getTags(function(tags) {
      if (!tagsFromUrl().length) {
        $db.view('couchtasks/tasks', {
          descending: true,
          include_docs: true,
          limit: currentLimit,
          success : function (data) {
            if (data.total_rows < currentLimit) {
              $(window).unbind('scroll', infiniteScroll);
            }
            tasks = $.map(data.rows, function(obj) { return obj.doc; });
            renderTasksList(tasks, tags, data.total_rows < currentLimit);
          }
        });
      } else {
        var args = [], tasks = [];
        function designDocs(args) {
          return $db.view('couchtasks/tags', args);
        }
        for (var x in tagsFromUrl()) {
          args.push({
            reduce:false,
            include_docs: true,
            startkey: [tagsFromUrl()[x]],
            endkey: [tagsFromUrl()[x]]
          });
        }
        $.when.apply(this, $.map(args, designDocs)).then(function () {
          if (args.length === 1) {
            arguments = [arguments];
          }
          $.each(arguments, function(element, i) {
            $.each(i[0].rows, function(y) {
              var exists = function(doc) { return doc._id === i[0].rows[y].id; };

              if (arraySubset(tagsFromUrl(), i[0].rows[y].doc.tags) &&
                  !arrayAny(tasks, exists)) {
                tasks.push(i[0].rows[y].doc);
              }
            });
          });
          renderTasksList(tasks, tags);
        });
      }
    });
  }


  function renderTasksList(tasks, tags, end) {

    tasks.sort(function(a, b) { return b.index - a.index; });

    var date = new Date();
    var today = new Date();
    var todolists = {};
    var completedlists = {};
    var hour = 0;

    $.each(tasks, function(_, obj) {

      var list = obj.check ? completedlists : todolists;
      var thisDate = obj.check ? new Date() : date;
      var prefix  = obj.check ? "z" : "";

      obj.estimate = obj.estimate || 60;

      if (obj.check && obj.check_at) {
        thisDate = new Date(obj.check_at);
      }

      if (typeof list[prefix + thisDate.toDateString()] === 'undefined') {
        list[prefix + thisDate.toDateString()] = {
          jsonDate: thisDate,
          date:formatDate(thisDate),
          notes: [],
          completed: prefix === 'z'
        };
      }
      list[prefix + thisDate.toDateString()].notes.push(obj);
      if (!obj.check) {
        hour += obj.estimate;
      }
      if (hour >= (8 * 60)) {
        hour = 0;
        date.setDate(date.getDate() - 1);
      }
    });

    var obj = {tasklist: []};

    for (var x in todolists) {
      obj.tasklist.push(todolists[x]);
    }
    for (var x in completedlists) {
      obj.tasklist.push(completedlists[x]);
    }


    var rendered =
      $('<div>' + Mustache.to_html($('#rows_tpl').html(), obj) + '</div>');
    createCheckBox(rendered);
    $('.checker', rendered).bind('change', markDone);

    var usedTags = $.map(tags, function(obj) {
        return {
          tag: obj.tag,
          count: obj.count,
          active: !($.inArray(obj.tag, tagsFromUrl()) === -1)
        };
    });

    var renderedTags =
      $('<div>' + Mustache.to_html($('#tags_tpl').html(), {tags: usedTags}) +
        '</div>');

    $('#filter_tags').empty().append(renderedTags.children());
    $('#tasks_wrapper').empty().append(rendered.children());

    $("#infinite_load").hide();
    if (end) {
      $('#tasks_end').show();
    }

    if (!Utils.isMobile()) {
      $('#tasks_wrapper ul').sortable({
        connectWith: $('#tasks_wrapper ul'),
        items: 'li:not(.date)',
        axis:'y',
        distance:30,
        start: function(event, ui) {
          ui.item.attr('data-noclick','true');
        },
        stop: function(event, ui) {
          var index = createIndex(ui.item);
          if (index !== false) {
            updateIndex(ui.item.attr('data-id'), index);
          }
        }
      });
    }
  }

  /*
   * Update filter url, adding or removing the key as needed
   */
  function updateFilterUrl(key) {
    var keys = arrayToggle(tagsFromUrl(), key);
    document.location.hash = '#/tags/' + keys.join(',');
  }


  /*
   * If a key is in the array, remove it, otherwise add it
   */
  function arrayToggle(arr, key) {
    if ($.inArray(key, arr) === -1) {
      arr.push(key);
    } else {
      arr = $.grep(arr, function(x) { return x !== key; });
    }
    return arr;
  }


  /*
   * Returns a list of tags that are specified in the current url under
   * the #/tags/ uri
   */
  function tagsFromUrl() {
    var match = router.matchesCurrent('#/tags/*test');
    return $.grep(match[1].split(','), function(x) { return x !== ''; });
  }


  /*
   * Return true if any of the items in the array satifies the anyFun predicate
   */
  function arrayAny(arr, anyFun) {
    for(var obj in arr) {
      if (anyFun(arr[obj])) {
        return true;
      }
    }
    return false;
  }


  /*
   * Naive implementation to check that arr1 is a full subset of arr2
   */
  function arraySubset(arr1, arr2) {
    var i = 0;
    $.each(arr1, function(_, val) {
      if ($.inArray(val, arr2) !== -1) {
        ++i;
      }
    });
    return i === arr1.length;
  }


  /*
   * Each task is given a numerical index which defines what order they
   * should be displayed in, when we reorder something calculate its index
   * based on the surrounding tasks
   */
  function createIndex(el) {

    var before = el.prev('li.task');
    var after = el.next('li.task');

    if (before.length === 0 && after.length === 0) {
      return false;
    } else if (before.length === 0) {
      return after.data('index') + 1;
    } else if (after.length === 0) {
      return before.data('index') - 1;
    } else {
      return (before.data('index') + after.data('index')) / 2;
    }
  }


  /*
   * Wrapper function for cross browser transforms
   */
  function transformX(dom, x) {
    dom.css('-moz-transform', 'translate(' + x + 'px, 0)')
      .css('-webkit-transform', 'translate(' + x + 'px, 0)');
  }


  /*
   * Android makes butt ugly checkboxes, so we just make our own with images
   * initialises checkboxes for everything inside 'parent', this needs to be
   * run on anything dynamically put into DOM
   */
  function createCheckBox(parent) {
    $('input[type=checkbox]', parent).each(function() {
      var $input = $(this).wrap('<div class="checkbox"></div>');
      var $wrapper = $(this).parent(".checkbox").append('<div />');
      if ($input.is(':checked')) {
        $wrapper.addClass('checked');
      }
      $wrapper.bind('click', function(){
        $wrapper.toggleClass('checked');
        $input.attr('checked', !$input.is(':checked')).change();
      });
    });
  };


  /*
   * Given a string "a random string #with #tags" parse out the hash tags
   * and return the tags and plain string seperately
   */
  function extractHashTags(text) {

    var matches = text.match(/\#([\w\-\.]*[\w]+[\w\-\.]*)/g) || [];
    var tags = $.map(matches, function(tag) { return tag.slice(1); });

    return {
      tags: tags,
      text: text.replace(/\#([\w\-\.]*[\w]+[\w\-\.]*)/g, '').trim()
    };
  }


  /*
   * What it says on the tin
   */
  function formatDate(date) {
    var d = date.getDate();
    var prefix = (d === 1) ? 'st' : (d === 2) ? 'nd' : (d === 3) ? 'rd' : 'th';
    return days[date.getDay()] + " " + date.getDate() + prefix +
      " of " + months[date.getMonth()];
  }


  /*
   * Fetches the current set of tags from a CouchDB view, for every tag we
   * ensure there is a corresponding style definition for its colour
   */
  function getTags(callback) {
    $db.view('couchtasks/tags', {group: true}).then(function(data) {
      var x, tag, i = 0, css = [], tags = [];
      for (x in data.rows) {
        tag = data.rows[x].key[0]
        css.push('.tag_' + tag + ' { background: ' + tagColors[i++] + ' }');
        tags.push({tag: tag, count: data.rows[x].value});
      }

      $("#tag_defs").html(css.join('\n'));
      callback(tags);
    });
  };

  /*
   * Handles any incoming real time changes from CouchDB, this will either
   * trigger a full page load if the design doc has changed, or update
   * the current list of tasks if needed
   */
  function handleChanges() {

    $changes = $db.changes();
    $changes.onChange(function(changes) {

      var doRefresh = false;

      $.each(changes.results, function(_, change) {

        // Full refresh if design doc changes
        if (/^_design/.test(change.id)) {
          document.location.reload();
        }

        // Otherwise check for changes that we didnt cause
        if (!doRefresh && $.inArray(change.id, myChanges) === -1) {
          doRefresh = true;
        }

      });

      if (doRefresh && router.matchesCurrent('#/tags/*test')) {
        updateTaskList();
      }

    });
  }


  // the animation stuff needs to know the width of the browser
  $(window).bind('resize', function () {
    paneWidth = $('body').width();
  }).trigger('resize');


  // The layout wont let me put the submit button inside the form
  // proxy the submit button
  $('#save_task_btn').bind('click', function (e) {
    $('#edit_task_form').trigger('submit');
  });


  // Only start handling real time updates after a delay to get round
  // a silly bug in webkit that shows a page as still loading if ajax
  // requests are made before the whole page has loaded
  setTimeout(handleChanges, 1000);

  // Lets start this baby
  router.init(window);

})();
