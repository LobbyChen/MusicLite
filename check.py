import os
import sys
import socket
import urllib.request
import urllib.error
import time
import platform

# 配置测试目标 (可以根据需要修改)
TEST_URLS = {
    "百度 (国内)": "http://www.baidu.com",
    "Google (国外-需代理)": "http://www.google.com",
    "GitHub (国外-需代理)": "https://github.com",
    "Go Proxy (阿里云)": "https://mirrors.aliyun.com/goproxy/",
    "Go Proxy (官方)": "https://proxy.golang.org"
}

def get_env_proxies():
    """获取环境变量中的代理设置"""
    proxies = {}
    env_vars = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 
                'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']
    
    print("--- 1. 环境变量检测 ---")
    found = False
    for var in env_vars:
        value = os.environ.get(var)
        if value:
            print(f"  [找到] {var} = {value}")
            proxies[var.lower()] = value
            found = True
    
    if not found:
        print("  [无] 未发现常见的代理环境变量。")
    print()
    return proxies

def get_windows_system_proxy():
    """仅适用于 Windows: 从注册表读取系统代理设置"""
    if platform.system() != "Windows":
        return None
        
    try:
        import winreg
        # 打开注册表键
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        
        # 检查代理是否启用
        proxy_enable, _ = winreg.QueryValueEx(key, "ProxyEnable")
        
        if proxy_enable:
            proxy_server, _ = winreg.QueryValueEx(key, "ProxyServer")
            print("--- 2. Windows 系统代理检测 ---")
            print(f"  [启用] 系统代理已开启: {proxy_server}")
            print("  [注意] Go 语言在某些情况下会继承此系统代理设置。")
            print()
            return proxy_server
        else:
            print("--- 2. Windows 系统代理检测 ---")
            print("  [禁用] 系统代理未开启。")
            print()
            return None
    except Exception as e:
        print(f"  [错误] 无法读取 Windows 注册表: {e}")
        return None

def test_connection(url, timeout=5):
    """测试单个 URL 的连通性"""
    try:
        start_time = time.time()
        # 创建一个请求对象
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        
        # 如果环境变量中有代理，urllib 默认会使用它们。
        # 如果想强制不使用代理，可以传入 proxies={}
        
        response = urllib.request.urlopen(req, timeout=timeout)
        elapsed = time.time() - start_time
        status = response.getcode()
        return True, status, elapsed, None
    except urllib.error.HTTPError as e:
        return False, e.code, 0, f"HTTP Error: {e.reason}"
    except urllib.error.URLError as e:
        reason = str(e.reason)
        return False, 0, 0, f"URL Error: {reason}"
    except socket.timeout:
        return False, 0, 0, "Connection Timed Out"
    except Exception as e:
        return False, 0, 0, str(e)

def main():
    print("="*60)
    print("       Python 代理与网络连通性检测工具")
    print("="*60)
    print()

    # 1. 检测环境变量
    env_proxies = get_env_proxies()

    # 2. 检测 Windows 系统代理
    if platform.system() == "Windows":
        get_windows_system_proxy()

    print("--- 3. 网络连接测试 ---")
    print(f"{'目标':<20} {'状态':<8} {'耗时(s)':<10} {'详情'}")
    print("-" * 60)

    results = {}
    for name, url in TEST_URLS.items():
        success, status, elapsed, error_msg = test_connection(url)
        
        if success:
            status_str = "OK"
            detail = f"Status: {status}"
        else:
            status_str = "FAIL"
            detail = error_msg[:40] # 截断错误信息以保持表格整齐
            
        print(f"{name:<20} {status_str:<8} {elapsed:<10.3f} {detail}")
        results[name] = success

    print()
    print("--- 4. 诊断建议 ---")
    
    # 基于结果的简单诊断
    baidu_ok = results.get("百度 (国内)", False)
    google_ok = results.get("Google (国外-需代理)", False)
    goproxy_ali_ok = results.get("Go Proxy (阿里云)", False)
    goproxy_official_ok = results.get("Go Proxy (官方)", False)

    if not baidu_ok:
        print("[严重] 无法访问国内网站 (百度)。请检查您的基本网络连接或防火墙设置。")
    elif google_ok:
        print("[正常] 您可以直接访问 Google。如果您在中国大陆，这可能意味着您全局开启了代理，或者网络环境特殊。")
        print("       Go 安装问题可能不是代理引起的，而是其他原因。")
    elif not google_ok and goproxy_ali_ok:
        print("[推荐] 无法访问 Google，但可以访问阿里云 Go 代理。")
        print("       建议设置 GOPROXY 为阿里云镜像以解决 go install 问题：")
        print("       go env -w GOPROXY=https://mirrors.aliyun.com/goproxy/,direct")
    elif not goproxy_ali_ok:
        print("[警告] 无法访问阿里云 Go 代理。请检查防火墙或 DNS 设置。")
        print("       尝试 ping mirrors.aliyun.com 看是否通。")
    
    if env_proxies:
        print("\n[提示] 检测到环境变量中设置了代理。如果 go install 失败，")
        print("       可能是该代理地址无效。尝试清空代理变量后重试：")
        print("       set HTTP_PROXY=")
        print("       set HTTPS_PROXY=")

    print("\n检测完成。")

if __name__ == "__main__":
    main()