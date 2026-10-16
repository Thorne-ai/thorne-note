// archery 导出查询数据, 可直接在console粘贴运行. 注意html标签id

(async () => {
    const id = "query_result1";
    const $ = window.jQuery;
    const table = document.getElementById(id);

    if (!table || !$?.fn?.bootstrapTable ||
        !$(table).data("bootstrap.table")) {
        throw new Error("未找到 Bootstrap Table 实例，请确认 Console 位于表格所在页面。");
    }

    const $table = $(table);
    const options = () => $table.bootstrapTable("getOptions");
    const getRows = () => $table.bootstrapTable("getData", {
        useCurrentPage: false,
        includeHiddenRows: true
    });

    if (table.dataset.csvExporting) {
        throw new Error("正在导出，请勿重复执行。");
    }

    // 按当前 HTML 表头的顺序导出。
    const columns = [...table.querySelectorAll("thead th[data-field]")]
        .map(th => ({
            field: th.getAttribute("data-field"),
            title: (th.querySelector(".th-inner") || th).textContent.trim()
        }));

    if (!columns.length) throw new Error("没有找到表头。");
    table.dataset.csvExporting = "1";

    // 服务端分页：等待加载成功，失败或超时则停止。
    function loadPage(page, pageSize) {
        return new Promise((resolve, reject) => {
            const success = "load-success.bs.table.csvExport";
            const failure = "load-error.bs.table.csvExport";

            const finish = error => {
                clearTimeout(timer);
                $table.off(success, onSuccess).off(failure, onError);
                if (error) reject(error);
                else resolve();
            };
            const onSuccess = () => finish();
            const onError = (_, status) =>
                finish(new Error(`第 ${page} 页加载失败：${status}`));
            const timer = setTimeout(
                () => finish(new Error(`第 ${page} 页加载超时，已停止导出。`)),
                60000
            );

            $table.one(success, onSuccess).one(failure, onError);
            try {
                $table.bootstrapTable("refresh", {
                    pageNumber: page,
                    pageSize
                });
            } catch (error) {
                finish(error);
            }
        });
    }

    // 所有字段使用 CSV 双引号转义，保留原始字符串。
    const escapeCSV = value =>
        `"${String(value ?? "").replace(/"/g, '""')}"`;

    const lines = [columns.map(c => escapeCSV(c.title)).join(",")];
    let count = 0;

    function appendRows(rows) {
        if (!Array.isArray(rows)) throw new Error("表格数据格式不正确。");
        for (const row of rows) {
            lines.push(columns.map(c => escapeCSV(row[c.field])).join(","));
            count++;
        }
    }

    try {
        if (options().sidePagination !== "server") {
            appendRows(getRows());
        } else {
            const pageSize = Number(options().pageSize);
            if (!options().pagination ||
                !Number.isInteger(pageSize) || pageSize <= 0) {
                throw new Error("请先开启分页，并选择数字类型的每页条数，再执行脚本。");
            }

            await loadPage(1, pageSize);
            const total = Number(options().totalRows);
            if (!Number.isSafeInteger(total) || total < 0) {
                throw new Error("无法获取准确的总行数，已停止导出。");
            }

            const pages = Math.max(1, Math.ceil(total / pageSize));

            for (let page = 1; page <= pages; page++) {
                if (page > 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    await loadPage(page, pageSize);
                }

                if (Number(options().pageNumber) !== page ||
                    Number(options().totalRows) !== total) {
                    throw new Error("页码或总行数发生变化，请重新查询后再导出。");
                }

                const rows = getRows();
                const expected = Math.min(pageSize, total - (page - 1) * pageSize);
                if (rows.length !== expected) {
                    throw new Error(
                        `第 ${page} 页应有 ${expected} 行，实际 ${rows.length} 行，已停止导出。`
                    );
                }

                appendRows(rows);
                console.log(`导出进度：${page}/${pages} 页，${count}/${total} 行`);
            }
        }

        const blob = new Blob(
            ["\uFEFF", lines.join("\r\n")],
            { type: "text/csv;charset=utf-8;" }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${id}_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);

        console.log(`✅ 导出完成：${count} 行（不含表头）`);
    } finally {
        delete table.dataset.csvExporting;
    }
})().catch(error => console.error("❌ 导出失败：", error));
