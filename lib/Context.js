/**
 * @file 验证器context对象，提供文件列表等支持
 * @author mengke01(kekee000@gmail.com)
 */
'use strict';
/* eslint-disable fecs-prefer-class */
const fs = require('fs');
const path = require('path');
const fileUtil = require('./fileUtil');
const config = require('./config');
const jsZip = require('jszip');
const minimatch = require('minimatch');

function values(object) {
    return Object.keys(object).map(key => object[key]);
}

/**
 * 执行上下文对象
 *
 * @constructor
 * @param {string} name  组件名称
 * @param {Object=} files 组件文件列表
 * @param {Array=} ignore 忽略检查的文件pattern列表
 */
function Context(name, files, ignore) {
    this.name = name;
    this.files = files || {};
    this.ingore = ignore || [];
}

/**
 * 检查文件是否在忽略检查的pattern列表里面
 *
 * @param {string} filePath 文件路径
 * @return {boolean}
 */
Context.prototype.isIgnore = function (filePath) {
    if (!this.ignore.length) {
        return false;
    }

    for (let i = 0, pattern; pattern = this.ignore[i]; i++) {
        let result = minimatch(filePath, pattern);
        if (result) {
            return true;
        }
    }
    return false;
};

/**
 * 添加一个文件
 *
 * @param {Object} file 文件对象
 *
 * @return {this}
 */
Context.prototype.addFile = function (file) {
    if (this.files[file.path]) {
        throw new Error('exists file:' + file.path);
    }

    this.files[file.path] = file;
    return this;
};

/**
 * 移除一个文件
 *
 * @param {Object|string} file 文件对象或者路径
 * @return {this}
 */
Context.prototype.removeFile = function (file) {
    if (typeof file === 'string') {
        delete this.files[file];
    }
    else {
        delete this.files[file.path];
    }
    return this;
};

/**
 * 文件是否存在
 *
 * @param {Object|string} file 文件对象或者路径
 * @return {boolean}
 */
Context.prototype.existsFile = function (file) {
    const path = typeof file === 'string' ? file : file.path;
    return !!this.files[path];
};

/**
 * 获取文件内容
 *
 * @param {Object|string} file 文件对象或者路径
 * @return {Object}
 */
Context.prototype.getFile = function (file) {
    const path = typeof file === 'string' ? file : file.path;
    return this.files[path];
};

/**
 * 获取文件列表
 *
 * @param {Regexp|Function=} pattern 文件过滤规则
 * @return {Array.<File>}
 */
Context.prototype.getFiles = function (pattern) {
    if (!pattern) {
        return values(this.files);
    }

    // 文件过滤规则，支持function和regex
    let filterFn = function () {
        return true;
    };

    if (typeof pattern === 'function') {
        filterFn = pattern;
    }
    else if (pattern instanceof RegExp) {
        filterFn = function (file) {
            return !!file.path.match(pattern);
        };
    }

    return values(this.files).filter(filterFn);
};


/**
 * 从文件中加载组件信息，返回创建的context对象
 *
 * @param  {string} filePath 文件路径
 * @return {Context} Context对象
 */
Context.load = function (filePath) {
    return new Promise(resolve => {
        if (!fs.existsSync(filePath)) {
            throw new Error('没有找到组件目录!');
        }

        const baseDir = path.dirname(filePath);
        const context = new Context(path.basename(filePath));
        const binaryFiles = []; // 二进制文件
        const deepDepthFiles = []; // 深层次文件

        // 读取目录下的文件
        fileUtil.walkDir(filePath, (absolutePath, depth) => {
            const relativePath = path.relative(baseDir, absolutePath);

            if (depth > config.maxFileDepth) {
                deepDepthFiles.push(relativePath);
                return;
            }

            if (!fileUtil.isPlainText(absolutePath)) {
                binaryFiles.push(relativePath);
                return;
            }

            context.addFile({
                path: relativePath.replace(/\\/g, '/'), // 统一使用`/`作为目录分割
                content: fs.readFileSync(absolutePath, 'utf-8')
            });
        });
        if (deepDepthFiles.length) {
            throw new Error('存在深层级的文件，文件层级不能大于' + config.maxFileDepth + '级：\n'
                    + deepDepthFiles.join('\n'));
        }

        if (binaryFiles.length) {
            throw new Error('存在非文本类型的文件：\n' + binaryFiles.join('\n'));
        }

        resolve(context);
    }, (e) => {
        console.error(e);
    });
};

/**
 * 从zip文件中加载组件信息，返回创建的context对象
 *
 * @param  {string} filePath 文件路径
 * @return {Context} Context对象
 */
Context.loadZip = function (filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            throw new Error('could not find zip file!');
        }

        const filter = function (path) {
            return fileUtil.isPlainText(path);
        };

        // read a zip file
        fs.readFile(filePath, (err, data) => {
            if (err) {
                throw new Error('read zip file error!');
            }

            jsZip.loadAsync(data)
                .then(function (zip) {
                    const files = [];
                    zip.forEach((relativePath, entry) => {
                        // 过滤系统文件夹，隐藏文件夹
                        if (relativePath.indexOf('__MACOSX') >= 0
                            || relativePath.indexOf('.DS_Store') >= 0
                            || relativePath.indexOf('Thumbs.db') >= 0
                        ) {
                            return;
                        }

                        if (!entry.dir && filter(relativePath)) {
                            files.push(relativePath);
                        }
                    });

                    if (!files.length) {
                        reject(new Error('找不到mip组件目录!'));
                        return;
                    }

                    const extensionName = files[0].slice(0, files[0].indexOf('/'));
                    if (!extensionName.match(config.elementNameRegex)) {
                        reject(new Error('找不到mip组件目录!'));
                        return;
                    }

                    const deepDepthFiles = files.filter(file => {
                        const m = file.match(/\//g);
                        return m ? m.length > config.maxFileDepth : true;
                    });

                    if (deepDepthFiles.length) {
                        reject(new Error('存在深层级的文件，文件层级不能大于'
                                + config.maxFileDepth + '级：\n'
                                + deepDepthFiles.join('\n')));
                        return;
                    }

                    const promises = files.map(file => zip.file(file).async('string'));
                    const context = new Context(extensionName);

                    // 将过滤后的文件添加到context
                    const promisesResolver = function (contents) {
                        files.forEach((file, i) => {
                            context.addFile({
                                path: file,
                                content: contents[i]
                            });
                        });

                        return context;
                    };
                    // 解压指定文件
                    return Promise.all(promises).then(promisesResolver);
                })
                .then(resolve, (e) => {
                    reject(new Error('读取zip文件错误！'));
                });
        });
    });
};

module.exports = Context;
