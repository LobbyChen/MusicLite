#include <iostream>
#include <stdint.h>
#include <vector>
#include <array>
#include <Eigen/Dense>

// cpp端go结构体映射
struct single_tag {
    uint64_t size_of; // 维度数量
    std::vector<std::vector<double>> datas;// 数据 ; 外部数组长度为维度数量,内部为数据,例如 数据1的
    std::vector<int> tags; // 数据标记
};


struct HyperplaneEigen {
    Eigen::VectorXd weights; // 法向量 w
    double bias;             // 偏置 b

    HyperplaneEigen(const Eigen::VectorXd& w, double b) 
        : weights(w), bias(b) {}

    // 计算有符号距离
    double signedDistance(const Eigen::VectorXd& x) const {
        // w.dot(x) + b
        double numerator = weights.dot(x) + bias;
        // ||w||
        double denominator = weights.norm();
        
        if (denominator == 0) return 0.0;
        return numerator / denominator;
    }
    
    // 投影点 onto 超平面
    Eigen::VectorXd project(const Eigen::VectorXd& x) const {
        double dist = signedDistance(x);
        // x_proj = x - dist * (w / ||w||)
        return x - dist * (weights / weights.norm());
    }
};

class SVM{
    public:
    uint16_t calc(void *single_point); // 返回tag,参数为一个数组指针 <dimension1_var,dimension2_var,......>
    bool train(std::vector<single_tag> *datas);
    private:
    uint16_t dimension_count;
    HyperplaneEigen storaged_hyperplane;
    std::vector<single_tag> datas;
};